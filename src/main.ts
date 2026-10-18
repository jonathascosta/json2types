// A meta tag can't carry the frame-ancestors policy and GitHub Pages can't send headers, so the
// content stays hidden (styles.css) until this confirms the page isn't framed by another site.
// Framed, it shows only a link to open it on its own: browsers no longer let a frame redirect the
// page around it without a click. This is best effort: a sandboxed frame without scripts skips it,
// but then the tool, which needs scripts, doesn't work there either. Real protection would need a
// frame-ancestors header from a proxy in front of GitHub Pages.
if (window.top === window.self) {
  document.body.classList.add('unframed');
} else {
  const link = document.createElement('a');
  link.href = window.location.href;
  link.target = '_top';
  link.textContent = 'Open json2types in its own tab';
  document.body.replaceChildren(link);
}

const statusLine = document.getElementById('status');
if (statusLine) statusLine.textContent = `Coming soon · v${__APP_VERSION__}`;

export {};
