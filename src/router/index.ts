import { createRouter, createWebHashHistory } from 'vue-router'
import Dashboard from '../views/Dashboard.vue'
import Projection from '../views/Projection.vue'

const routes = [
    { path: '/', component: Dashboard },
    { path: '/settings', component: () => import('../views/Settings.vue') },
    { path: '/projection/:id', component: Projection, props: true }
]

const router = createRouter({
    history: createWebHashHistory(),
    routes
})

export default router
