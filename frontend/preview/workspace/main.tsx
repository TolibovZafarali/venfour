const staffPreview = /^(\/admin(?:\/|$)|\/partners(?:\/|$)|\/_local\/businesses(?:\/|$))/.test(location.pathname);
if (staffPreview) await import("./staff/main");
else await import("./customer");
export {};
