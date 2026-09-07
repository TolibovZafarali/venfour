import path from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import {defineConfig} from 'vite';
const here=import.meta.dirname;
export default defineConfig({root:here,envDir:here,plugins:[react(),tailwindcss()],define:{'import.meta.env.VITE_SUPABASE_URL':JSON.stringify(''),'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY':JSON.stringify('')},resolve:{alias:{'@':path.resolve(here,'../src')}},server:{host:'127.0.0.1',port:4179,strictPort:true,fs:{allow:[path.resolve(here,'../..')]}}});
