import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import './assets/styles/glass.css'
import App from './App.vue'
import router from './router'
import { useAuthStore } from './store/auth'
import { tiltDirective } from './directive/tilt'

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)
app.use(router)
app.use(ElementPlus)
app.directive('tilt', tiltDirective)
useAuthStore(pinia).hydrate()
app.mount('#app')

