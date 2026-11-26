import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import './styles/glass.css'
import App from './App.vue'
import router from './router'
import { useAuthStore } from './stores/auth'
import { tiltDirective } from './directives/tilt'

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)
app.use(router)
app.use(ElementPlus)
app.directive('tilt', tiltDirective)
useAuthStore(pinia).hydrate()
app.mount('#app')

