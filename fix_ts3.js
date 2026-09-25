const fs = require('fs');
const path = 'd:\\download\\RealtyHRM-fixed\\RealtyHRM-fixed\\screens\\admin\\TVDisplayScreen.tsx';
let code = fs.readFileSync(path, 'utf8');

// Fix Easing import: if Easing is missing, add it to react-native imports
if (!code.includes('Easing,')) {
    code = code.replace(/import\s*{\s*StyleSheet,\s*View,\s*Text,\s*ScrollView,\s*Modal,\s*Image,/g, 'import { StyleSheet, View, Text, ScrollView, Modal, Image, Easing,');
    if (!code.includes('Easing,')) {
         code = code.replace(/import\s*{\s*StyleSheet,\s*View,\s*Text,\s*ScrollView,\s*Modal,/g, 'import { StyleSheet, View, Text, ScrollView, Modal, Image, Easing,');
    }
}

// Ensure Easing is really there. If the above regex fails, just add it directly at the top.
if (!code.includes('import { Easing } from "react-native";') && !code.includes('Easing,')) {
    code = code.replace('import { StyleSheet,', 'import { StyleSheet, Easing,');
}

// Fix FeedItem interface: if rawTime is missing
if (!code.includes('rawTime: string;')) {
    code = code.replace(
        '  isNew?: boolean;    // highlight newest entry\n}',
        '  isNew?: boolean;    // highlight newest entry\n  rawTime: string;\n}'
    );
}

// Double check the interface replacing logic in case it had 'rawTime?: string;'
code = code.replace('rawTime?: string;', 'rawTime: string;');

fs.writeFileSync(path, code);
console.log('Fixed final TS issues');
