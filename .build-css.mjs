import postcss from 'postcss'
import tw from '@tailwindcss/postcss'
import fs from 'node:fs'
const css = fs.readFileSync('/home/user/Qr-kod-menyu/src/app/globals.css','utf8')
const res = await postcss([tw()]).process(css, { from: '/home/user/Qr-kod-menyu/src/app/globals.css' })
fs.writeFileSync('/tmp/claude-0/-home-user-Qr-kod-menyu/e9a0345b-6c59-568a-8559-667fd3240b2c/scratchpad/out.css', res.css)
console.log('OK bytes:', res.css.length)
console.log('warnings:', res.warnings().map(String))
