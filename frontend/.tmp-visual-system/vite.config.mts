import path from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import {defineConfig} from 'vite';
export default defineConfig({root:path.resolve(import.meta.dirname,'..'),envDir:false,plugins:[react(),tailwindcss()],define:{'import.meta.env.VITE_SUPABASE_URL':'""','import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY':'""','import.meta.env.VITE_API_BASE_URL':'""'},resolve:{alias:{'@':path.resolve(import.meta.dirname,'../src')}},server:{host:'127.0.0.1',port:4191,strictPort:true,fs:{allow:[path.resolve(import.meta.dirname,'../..')]}}});
