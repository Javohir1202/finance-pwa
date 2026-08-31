import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({plugins:[react(),tailwindcss(),VitePWA({registerType:'autoUpdate',includeAssets:['icon-192.png','icon-512.png'],manifest:{name:'Finance — личные финансы',short_name:'Finance',description:'Личный мониторинг доходов и расходов',theme_color:'#0b0d12',background_color:'#0b0d12',display:'standalone',start_url:'/',scope:'/',icons:[{src:'/icon-192.png',sizes:'192x192',type:'image/png'},{src:'/icon-512.png',sizes:'512x512',type:'image/png'}]}})]});
