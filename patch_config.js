const fs = require('fs');
let config = fs.readFileSync('app.config.js', 'utf8');

if (!config.includes('// Patch plugins for missing google services')) {
  config = config.replace(
    'module.exports = ({ config }) => ({',
    module.exports = ({ config }) => {
  const hasGoogleServices = !!process.env.GOOGLE_SERVICES_JSON || !!config.android?.googleServicesFile;
  // Patch plugins for missing google services to prevent instant Android crash
  if (!hasGoogleServices && config.plugins) {
    config.plugins = config.plugins.map(plugin => {
      if (Array.isArray(plugin) && plugin[0] === 'expo-notifications') {
        return ['expo-notifications', { ...plugin[1], enableBackgroundRemoteNotifications: false }];
      }
      return plugin;
    });
  }
  return {
  ).replace('});', '};\n});');
  fs.writeFileSync('app.config.js', config);
}
