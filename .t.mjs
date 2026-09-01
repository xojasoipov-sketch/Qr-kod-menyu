import postcss from 'postcss'; import tw from '@tailwindcss/postcss'; import fs from 'node:fs'
const r = await postcss([tw()]).process(fs.readFileSync('/home/user/Qr-kod-menyu/.t.css','utf8'), {from:'/home/user/Qr-kod-menyu/.t.css'})
const m = r.css.match(/--color-(lane|zzz)[^\n]*/g)
console.log(m)
