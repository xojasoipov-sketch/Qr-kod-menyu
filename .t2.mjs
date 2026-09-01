import postcss from 'postcss'; import tw from '@tailwindcss/postcss'; import fs from 'node:fs'
const r = await postcss([tw()]).process(fs.readFileSync('/home/user/Qr-kod-menyu/.t.css','utf8'), {from:'/home/user/Qr-kod-menyu/.t.css'})
fs.writeFileSync('/home/user/Qr-kod-menyu/.t.out.css', r.css)
const want=['.bg-lane-new','.text-lane-late','.border-lane-ready','.bg-surface','.text-text-muted','.border-border-strong','.rounded-card','.rounded-control','.shadow-card','.bg-accent-strong','.text-accent-contrast','.text-display-xl','.text-kds-hero','.text-admin-metric','.font-display','.font-mono','.animate-shimmer','.duration-base','.ease-spring','.z-toast','.max-w-customer','.bg-slate-700','.text-blue-500','.rounded-2xl','.bg-wine-soft','.bg-info-soft']
for(const w of want) console.log((r.css.includes(w+' ')||r.css.includes(w+',')||r.css.includes(w+'{')?'YES':'no ').padEnd(4), w)
console.log('customer variant:', r.css.includes('data-surface="customer"'))
console.log('kds variant:', /\.kds\\:p-8/.test(r.css)||r.css.includes('kds\\:'))
console.log('dark variant:', r.css.includes('dark\\:'))
