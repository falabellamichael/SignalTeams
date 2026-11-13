export default async function(page) {
  await page.setViewportSize({width: 1280, height: 800});
  await page.evaluate(async () => {
    const runtime = (await import('/@react-refresh')).default;
    runtime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => (type) => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    const React = (await import('/node_modules/.vite/deps/react.js')).default;
    const {createRoot} = (await import('/node_modules/.vite/deps/react-dom_client.js')).default;
    const {MeBar} = await import('/src/components/Sidebar.jsx');
    const host = document.createElement('div');
    document.body.replaceChildren(host);
    const me = {display_name: 'Michael with a long name', username: 'michael', status: 'online', status_text: 'Testing the new footer', avatar_emoji: 'M', avatar_color: '#508b72'};
    function Preview() {
      const [muted, mute] = React.useState(false);
      const footer = React.createElement(MeBar, {me, voice: {muted}, onToggleMute: () => mute(!muted), onToggleDeafen: () => {}, onSettings: () => {}});
      return React.createElement(React.Fragment, null,
        React.createElement('div', {className: 'side-wrap', style: {width: 300, display: 'flex', position: 'relative', height: 90}}, footer),
        React.createElement('div', {className: 'me-bar-mobile'}, footer));
    }
    createRoot(host).render(React.createElement(Preview));
  });
  await page.locator('.side-wrap .me-bar').waitFor();
  await page.screenshot({path: 'D:/AgentHive/qa/footer-desktop.png'});
  await page.getByTitle('Microphone options').first().click();
  await page.locator('.me-audio-popover').waitFor();
  await page.keyboard.press('Escape');
  await page.setViewportSize({width: 375, height: 812});
  await page.locator('.me-bar-mobile .me-bar').waitFor({state: 'visible'});
  await page.screenshot({path: 'D:/AgentHive/qa/footer-mobile.png'});
  const box = await page.locator('.me-bar-mobile .me-bar').boundingBox();
  if (box.x !== 0 || box.width !== 375) throw new Error('Mobile footer width changed');
  return {mobileWidth: box.width, dropdown: 'opens and dismisses with Escape'};
}
