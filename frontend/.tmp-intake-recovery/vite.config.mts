import path from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import {defineConfig} from 'vite';
const here=import.meta.dirname;
export default defineConfig({root:here,envDir:here,plugins:[react(),tailwindcss()],resolve:{alias:[{find:'@',replacement:path.resolve(here,'../src')}]},server:{host:'127.0.0.1',port:4180,strictPort:true,fs:{allow:[path.resolve(here,'../..')]}}});
