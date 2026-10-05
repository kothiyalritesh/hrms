require('@babel/register')({ presets: ['@babel/preset-env', '@babel/preset-react', '@babel/preset-typescript'] });
const comp = require('./screens/admin/AdminDeviceSessionsScreen.tsx');
console.log('Component default:', typeof comp.default);
