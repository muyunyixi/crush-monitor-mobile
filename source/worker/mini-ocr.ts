export type MiniOcrEnv = {
  WECHAT_APP_ID?: string;
  WECHAT_APP_SECRET?: string;
};

type WechatResult = { errcode?: number; errmsg?: string; access_token?: string; expires_in?: number; openid?: string; items?: Array<{ text?: string; itemcoord?: { x?: number; y?: number; width?: number; height?: number } }> };

let tokenCache: { token: string; expires: number } | undefined;

function failure(error: string, status: number) {
  return Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
}

async function wechatJson(url: string, options?: RequestInit): Promise<WechatResult> {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error('WECHAT_NETWORK');
  return (await response.json()) as WechatResult;
}

async function getToken(appid: string, secret: string) {
  if (tokenCache && Date.now() < tokenCache.expires) return tokenCache.token;
  const url = new URL('https://api.weixin.qq.com/cgi-bin/token');
  url.searchParams.set('grant_type', 'client_credential');
  url.searchParams.set('appid', appid);
  url.searchParams.set('secret', secret);
  const data = await wechatJson(url.toString());
  if (!data.access_token) throw new Error('WECHAT_TOKEN');
  tokenCache = { token: data.access_token, expires: Date.now() + Math.max(0, (data.expires_in || 7200) - 300) * 1000 };
  return data.access_token;
}

/** A single image per request, sent as multipart from wx.uploadFile. */
export async function handleMiniOcr(request: Request, env: MiniOcrEnv, reserve: (openid: string) => Promise<{ allowed: boolean; unavailable?: boolean }>): Promise<Response> {
  if (!env.WECHAT_APP_ID) return failure('微信识字尚未配置：Worker 缺少 WECHAT_APP_ID。', 503);
  if (!env.WECHAT_APP_SECRET) return failure('微信识字尚未配置：Worker 缺少 WECHAT_APP_SECRET。', 503);
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('multipart/form-data'))
    return failure('请上传图片文件。', 400);
  const length = Number(request.headers.get('Content-Length') || 0);
  if (length > 4 * 1024 * 1024) return failure('截图过大，请选择小于 4 MB 的图片。', 413);
  let form: FormData;
  try { form = await request.formData(); } catch { return failure('图片上传格式错误。', 400); }
  const loginCode = form.get('loginCode');
  const image = form.get('image');
  if (typeof loginCode !== 'string' || !/^[\w-]{5,256}$/.test(loginCode))
    return failure('小程序登录信息缺失，请重试。', 401);
  if (!(image instanceof File) || image.size < 8 || image.size > 4 * 1024 * 1024)
    return failure('请选择小于 4 MB 的 JPG 或 PNG 图片。', 400);
  const header = new Uint8Array(await image.slice(0, 8).arrayBuffer());
  const png = header[0] === 137 && header[1] === 80 && header[2] === 78 && header[3] === 71;
  const jpeg = header[0] === 255 && header[1] === 216 && header[2] === 255;
  if (!png && !jpeg) return failure('微信识字只支持 JPG 或 PNG 图片。', 400);

  try {
    const loginUrl = new URL('https://api.weixin.qq.com/sns/jscode2session');
    loginUrl.searchParams.set('appid', env.WECHAT_APP_ID);
    loginUrl.searchParams.set('secret', env.WECHAT_APP_SECRET);
    loginUrl.searchParams.set('js_code', loginCode);
    loginUrl.searchParams.set('grant_type', 'authorization_code');
    const login = await wechatJson(loginUrl.toString());
    if (!login.openid) return failure('小程序登录已过期，请重试。', 401);

    const quota = await reserve(login.openid);
    if (quota.unavailable) return failure('识字额度服务暂时不可用。', 503);
    if (!quota.allowed) return failure('今日截图识字次数已用完，请明天再试。', 429);

    const token = await getToken(env.WECHAT_APP_ID, env.WECHAT_APP_SECRET);
    const ocrBody = new FormData();
    const upload = new File([image], png ? 'screenshot.png' : 'screenshot.jpg', { type: png ? 'image/png' : 'image/jpeg' });
    ocrBody.append('img', upload);
    const ocrUrl = new URL('https://api.weixin.qq.com/cv/ocr/comm');
    ocrUrl.searchParams.set('access_token', token);
    const result = await wechatJson(ocrUrl.toString(), { method: 'POST', body: ocrBody });
    if (result.errcode && result.errcode !== 0) {
      if ([40001, 42001].includes(result.errcode)) tokenCache = undefined;
      if ([48001, 40164].includes(result.errcode)) return failure('微信未开放此识字接口，或接口 IP 白名单未配置。', 502);
      return failure(`微信识字暂时失败（错误码 ${result.errcode}）。`, 502);
    }
    const items = (result.items || []).map(item => ({
      text: (item.text || '').trim(),
      itemcoord: item.itemcoord && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(item.itemcoord?.[key as keyof typeof item.itemcoord]))
        ? item.itemcoord : undefined,
    })).filter(item => item.text);
    return Response.json({ items, lines: items.map(item => item.text), text: items.map(item => item.text).join('\n') }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return failure('无法连接微信识字服务，请稍后重试。', 502);
  }
}
