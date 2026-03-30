(() => {
  const parseCookies = () =>
    Object.fromEntries(
      document.cookie
        .split(/;\s*/)
        .filter(Boolean)
        .map((part) => {
          const i = part.indexOf("=");
          const name = part.slice(0, i);
          const value = decodeURIComponent(part.slice(i + 1));
          return [name, value];
        })
        .filter(([name]) => name.startsWith("plannotator-"))
        .sort(([a], [b]) => a.localeCompare(b)),
    );

  const cookies = parseCookies();
  const json = JSON.stringify(cookies, null, 2);

  console.log(json);

  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "plannotator-cookies.json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
})();
