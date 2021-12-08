import Space from '@/views/Space.vue'
import store from '@/store/store.js'

import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'space',
      component: Space
    }, {
      path: '/beta',
      name: 'beta',
      component: Space,
      beforeEnter: (to, from, next) => {
        store.commit('isBeta', true)
        store.commit('addNotification', { message: 'No features currently in Beta' }) // 'No features currently in Beta'
        next()
      }
    }, {
      path: '/confirm-email',
      name: 'confirm-email',
      component: Space,
      redirect: to => {
        store.dispatch('currentUser/confirmEmail')
        store.commit('addNotification', { message: 'Email Confirmed', type: 'success' })
        return '/'
      }
    }, {
      path: '/reset-password',
      name: 'reset-password',
      component: Space,
      beforeEnter: (to, from, next) => {
        const urlParams = new URLSearchParams(window.location.search)
        const apiKey = urlParams.get('apiKey')
        if (apiKey) {
          store.commit('resetPasswordApiKey', apiKey)
          store.commit('passwordResetIsVisible', true)
        }
        next()
        history.replaceState({}, document.title, window.location.origin)
      }
    }, {
      path: '/update-arena-access-token',
      name: 'update-arena-access-token',
      component: Space,
      beforeEnter: (to, from, next) => {
        const urlParams = new URLSearchParams(window.location.search)
        const arenaReturnedCode = urlParams.get('code')
        next()
        history.replaceState({}, document.title, window.location.origin)
        store.dispatch('currentUser/updateArenaAccessToken', arenaReturnedCode)
      }
    }, {
      path: '/invite',
      name: 'invite',
      component: Space,
      beforeEnter: (to, from, next) => {
        store.dispatch('currentUser/init')
        const urlParams = new URLSearchParams(window.location.search)
        const apiKey = store.state.currentUser.apiKey
        const spaceId = urlParams.get('spaceId')
        const collaboratorKey = urlParams.get('collaboratorKey')
        if (!spaceId || !collaboratorKey) { return }
        store.commit('isLoadingSpace', true)
        if (apiKey) {
          store.dispatch('api/addSpaceCollaborator', { spaceId, collaboratorKey })
            .then(response => {
              store.commit('spaceUrlToLoad', spaceId)
              store.commit('addNotification', { message: 'You can now edit this space', type: 'success' })
              next()
            }).catch(error => {
              console.error('🚒', error)
              if (error.status === 401) {
                store.commit('addNotification', { message: 'Space could not be found, or your invite was invalid', type: 'danger' })
              } else {
                store.commit('addNotification', { message: '(シ_ _)シ Something went wrong, Please try again or contact support', type: 'danger' })
              }
            })
        } else {
          store.commit('spaceUrlToLoad', spaceId)
          next()
        }
        store.commit('addToSpaceCollaboratorKeys', { spaceId, collaboratorKey })
      }
    }, {
      path: '/journal',
      component: Space,
      beforeEnter: (to, from, next) => {
        store.commit('loadJournalSpace', true)
        next()
      }
    }, {
      path: '/new/today',
      component: Space,
      beforeEnter: (to, from, next) => {
        store.commit('loadJournalSpace', true)
        next()
      }
    }, {
      path: '/new/tomorrow',
      component: Space,
      beforeEnter: (to, from, next) => {
        store.commit('loadJournalSpace', true)
        store.commit('loadJournalSpaceTomorrow', true)
        next()
      }
    }, {
      path: '/new',
      component: Space,
      beforeEnter: (to, from, next) => {
        store.commit('loadNewSpace', true)
        next()
      }
    }, {
      path: '/:space/:card',
      component: Space,
      beforeEnter: (to, from, next) => {
        const path = window.location.pathname
        store.dispatch('updateSpaceAndCardUrlToLoad', path)
        next()
      }
    }, {
      path: '/:space',
      component: Space,
      beforeEnter: (to, from, next) => {
        const path = window.location.pathname
        store.dispatch('updateSpaceAndCardUrlToLoad', path)
        next()
      }
    }, {
      path: '/embed',
      component: Space,
      beforeEnter: (to, from, next) => {
        const urlParams = new URLSearchParams(window.location.search)
        const spaceId = urlParams.get('spaceId')
        const zoom = urlParams.get('zoom')
        store.commit('spaceUrlToLoad', spaceId)
        store.commit('spaceZoomPercent', zoom)
        store.commit('isEmbedMode', true)
        next()
      }
    }
    // {
    //   path: '/legal',
    //   name: 'legal',
    //   // route level code-splitting
    //   // this generates a separate chunk (about.[hash].js) for this route
    //   // which is lazy-loaded when the route is visited.
    //   component: () => import(/* webpackChunkName: "legal" */ './views/Legal.vue')
    // }
  ]
})

export default router
