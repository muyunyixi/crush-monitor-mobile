// User credentials deliberately live only in memory. The endpoint is public build config.
export const connection = {
  key: "",
  endpoint: (import.meta.env.VITE_ANALYSIS_ENDPOINT || "").trim(),
};
