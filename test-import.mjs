let mod = null;
try {
  mod = await import('socks-proxy-agent');
  console.log('Loaded from package context:', Object.keys(mod));
} catch (e) {
  console.log('Failed to load from package context:', e.message);
}
