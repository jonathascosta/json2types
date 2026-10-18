// A meta tag can't carry the frame-ancestors policy and GitHub Pages can't send headers, so when
// another site frames the page, it shows only a link to open it on its own. (Browsers no longer let
// a frame redirect the page around it without a click.)
if (window.top !== window.self) {
  const link = document.createElement('a');
  link.href = window.location.href;
  link.target = '_top';
  link.textContent = 'Open json2types in its own tab';
  document.body.replaceChildren(link);
}

const statusLine = document.getElementById('status');
if (statusLine) statusLine.textContent = `Coming soon · v${__APP_VERSION__}`;

export {};
