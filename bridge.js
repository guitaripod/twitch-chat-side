/**
 * Hands the monitor name from the extension to the page script through an attribute on the root element, which both worlds can see.
 */
function setScreen(screen) {
  if (screen) document.documentElement.dataset.tcsideScreen = screen;
  else delete document.documentElement.dataset.tcsideScreen;
}

chrome.runtime.onMessage.addListener(message => {
  if (message && 'tcsideScreen' in message) setScreen(message.tcsideScreen);
});

chrome.runtime.sendMessage({ tcsideHello: true })
  .then(reply => {
    if (reply?.tcsideScreen) setScreen(reply.tcsideScreen);
  })
  .catch(() => {});
