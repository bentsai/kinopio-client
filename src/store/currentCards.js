import utils from '@/utils.js'
import cache from '@/cache.js'

import { nanoid } from 'nanoid'
import uniqBy from 'lodash-es/uniqBy'
import uniq from 'lodash-es/uniq'
import debounce from 'lodash-es/debounce'
import { nextTick } from 'vue'

// normalized state
// https://github.com/vuejs/vuejs.org/issues/1636
let currentSpaceId

const cardMap = new Worker('/web-workers/card-map.js')
// receive
cardMap.addEventListener('message', event => {
  const cardMap = event.data
  currentCards.mutations.cardMap(currentCards.state, cardMap)
})
// send
const updateCardMapDebounced = debounce(function ({ cards, viewport, zoom }) {
  cardMap.postMessage({ cards, viewport, zoom })
}, 200)

const currentCards = {
  namespaced: true,
  state: {
    ids: [],
    cards: {}, // {id, {card}}
    removedCards: [], // denormalized
    cardMap: []
  },
  mutations: {

    // init

    clear: (state) => {
      state.ids = []
      state.cards = {}
      state.removedCards = []
      state.cardMap = []
    },
    restore: (state, cards) => {
      let cardIds = []
      cards.forEach(card => {
        cardIds.push(card.id)
        card.x = card.x || 100
        card.y = card.y || 100
        state.cards[card.id] = card
      })
      state.ids = state.ids.concat(cardIds)
    },

    // create

    create: (state, card) => {
      if (!card.id) {
        console.warn('🚑 could not create card', card)
        return
      }
      state.ids.push(card.id)
      state.cards[card.id] = card
      cache.updateSpace('cards', state.cards, currentSpaceId)
    },

    // update

    update: (state, card) => {
      if (!utils.objectHasKeys(card)) { return }
      if (!card.id) {
        console.warn('🚑 could not update card', card)
        return
      }
      if (card.x) {
        card.x = Math.round(card.x)
      }
      if (card.y) {
        card.y = Math.round(card.y)
      }
      const keys = Object.keys(card)
      keys.forEach(key => {
        state.cards[card.id][key] = card[key]
      })
      cache.updateSpaceCardsDebounced(state.cards, currentSpaceId)
    },
    move: (state, { cards, spaceId }) => {
      cards.forEach(card => {
        state.cards[card.id].x = card.x
        state.cards[card.id].y = card.y
      })
      cache.updateSpaceCardsDebounced(state.cards, currentSpaceId)
    },
    remove: (state, cardToRemove) => {
      if (!cardToRemove) { return }
      const card = state.cards[cardToRemove.id]
      state.ids = state.ids.filter(id => id !== card.id)
      delete state.cards[card.id]
      state.removedCards.unshift(card)
      cache.updateSpace('removedCards', state.removedCards, currentSpaceId)
      cache.updateSpace('cards', state.cards, currentSpaceId)
    },
    removedCards: (state, removedCards) => {
      state.removedCards = removedCards
    },
    deleteCard: (state, cardToDelete) => {
      if (!cardToDelete) { return }
      const card = state.cards[cardToDelete.id]
      if (card) {
        state.ids = state.ids.filter(id => id !== card.id)
        delete state.cards[card.id]
      }
      const shouldDelete = state.removedCards.find(removedCard => cardToDelete.id === removedCard.id)
      if (shouldDelete) {
        state.removedCards = state.removedCards.filter(removedCard => cardToDelete.id !== removedCard.id)
        cache.updateSpace('removedCards', state.removedCards, currentSpaceId)
      } else {
        cache.updateSpace('cards', state.cards, currentSpaceId)
      }
    },
    restoreRemoved: (state, card) => {
      // restore
      const cardId = card.id
      state.ids.push(cardId)
      state.cards[cardId] = card
      cache.updateSpace('cards', state.cards, currentSpaceId)
      // update removed
      state.removedCards = state.removedCards.filter(removedCard => removedCard.id !== cardId)
      cache.updateSpace('removedCards', state.removedCards, currentSpaceId)
    },

    // broadcast

    moveWhileDraggingBroadcast: (state, { cards }) => {
      cards.forEach(card => {
        const element = document.querySelector(`article[data-card-id="${card.id}"]`)
        element.style.left = card.x + 'px'
        element.style.top = card.y + 'px'
      })
    },
    moveBroadcast: (state, { cards }) => {
      cards.forEach(updated => {
        const card = state.cards[updated.id]
        if (!card) { return }
        card.x = updated.x
        card.y = updated.y
      })
      cache.updateSpaceCardsDebounced(state.cards, currentSpaceId)
    },

    // card map

    cardMap: (state, cardMap) => {
      utils.typeCheck({ value: cardMap, type: 'array', origin: 'cardMap' })
      state.cardMap = cardMap
    }
  },
  actions: {

    // init

    updateSpaceId: (context, spaceId) => {
      currentSpaceId = spaceId
    },
    mergeUnique: (context, newCards) => {
      newCards.forEach(newCard => {
        let shouldUpdate
        let prevCard = context.getters.byId(newCard.id)
        let card = { id: newCard.id }
        let keys = Object.keys(newCard)
        keys = keys.filter(key => key !== 'id')
        keys.forEach(key => {
          if (prevCard[key] !== newCard[key]) {
            card[key] = newCard[key]
            shouldUpdate = true
          }
        })
        if (!shouldUpdate) { return }
        context.commit('update', card)
      })
    },
    mergeRemove: (context, removeCards) => {
      removeCards.forEach(card => {
        context.commit('remove', card)
      })
    },

    // create

    add: (context, { position, isParentCard, name, id, backgroundColor }) => {
      utils.typeCheck({ value: position, type: 'object', origin: 'addCard' })
      if (context.rootGetters['currentSpace/shouldPreventAddCard']) {
        context.commit('notifyCardsCreatedIsOverLimit', true, { root: true })
        return
      }
      let cards = context.getters.all
      const highestCardZ = utils.highestCardZ(cards)
      let card = {
        id: id || nanoid(),
        x: position.x,
        y: position.y,
        z: highestCardZ + 1,
        name: name || '',
        frameId: 0,
        userId: context.rootState.currentUser.id,
        urlPreviewIsVisible: true,
        commentIsVisible: true,
        width: utils.emptyCard().width,
        height: utils.emptyCard().height,
        isLocked: false,
        backgroundColor
      }
      context.commit('cardDetailsIsVisibleForCardId', card.id, { root: true })
      card.spaceId = currentSpaceId
      context.dispatch('api/addToQueue', { name: 'createCard', handler: 'currentCards/add', body: card }, { root: true })
      context.dispatch('broadcast/update', { updates: card, type: 'createCard', handler: 'currentCards/create' }, { root: true })
      context.commit('create', card)
      if (isParentCard) { context.commit('parentCardId', card.id, { root: true }) }
      context.dispatch('currentUser/cardsCreatedCountUpdateBy', {
        delta: 1
      }, { root: true })
      context.dispatch('currentSpace/checkIfShouldNotifyCardsCreatedIsNearLimit', null, { root: true })
      context.dispatch('currentSpace/notifyCollaboratorsCardUpdated', { cardId: card.id, type: 'createCard' }, { root: true })
      context.dispatch('updateCardMap')
    },
    addMultiple: (context, newCards) => {
      newCards.forEach(card => {
        card = {
          id: card.id || nanoid(),
          x: card.x,
          y: card.y,
          z: card.z || context.state.ids.length + 1,
          name: card.name,
          frameId: card.frameId || 0,
          width: card.width || utils.emptyCard().width,
          height: card.height || utils.emptyCard().height,
          userId: context.rootState.currentUser.id,
          backgroundColor: card.backgroundColor
        }
        context.dispatch('api/addToQueue', { name: 'createCard', body: card }, { root: true })
        context.dispatch('broadcast/update', { updates: card, type: 'createCard', handler: 'currentCards/create' }, { root: true })
        context.commit('create', card)
      })
      context.dispatch('currentUser/cardsCreatedCountUpdateBy', {
        delta: newCards.length
      }, { root: true })
      context.dispatch('updateCardMap')
    },
    paste: (context, { card, cardId }) => {
      utils.typeCheck({ value: card, type: 'object', origin: 'pasteCard' })
      card.id = cardId || nanoid()
      card.spaceId = currentSpaceId
      const prevCards = context.getters.all
      utils.uniqueCardPosition(card, prevCards)
      const tags = utils.tagsFromStringWithoutBrackets(card.name)
      if (tags) {
        tags.forEach(tag => {
          tag = utils.newTag({
            name: tag,
            defaultColor: context.rootState.currentUser.color,
            cardId: card.id,
            spaceId: context.state.id
          })
          context.dispatch('currentSpace/addTag', tag, { root: true }) // TODO to tag module?
        })
      }
      context.dispatch('api/addToQueue', { name: 'createCard', body: card }, { root: true })
      context.dispatch('broadcast/update', { updates: card, type: 'createCard', handler: 'currentCards/create' }, { root: true })
      context.dispatch('currentUser/cardsCreatedCountUpdateBy', {
        delta: 1
      }, { root: true })
      context.dispatch('history/add', { cards: [card] }, { root: true })
      context.commit('create', card)
      context.dispatch('updateCardMap')
    },

    // update

    update: (context, card) => {
      // prevent null position
      const keys = Object.keys(card)
      if (keys.includes('x') || keys.includes('y')) {
        if (card.x === undefined || card.x === null) {
          delete card.x
        }
        if (card.y === undefined || card.y === null) {
          delete card.y
        }
      }
      context.dispatch('api/addToQueue', { name: 'updateCard', body: card }, { root: true })
      context.dispatch('broadcast/update', { updates: card, type: 'updateCard', handler: 'currentCards/update' }, { root: true })
      context.commit('hasEditedCurrentSpace', true, { root: true })
      context.dispatch('history/add', { cards: [card] }, { root: true })
      context.commit('update', card)
      if (card.name) {
        context.dispatch('updateDimensionsAndMap', card.id)
      }
    },

    updateCardName (context, { card, newName }) {
      const canEditCard = context.rootGetters['currentUser/canEditCard'](card)
      if (!canEditCard) { return }
      context.dispatch('update', {
        id: card.id,
        name: newName
      })
      context.dispatch('updateDimensionsAndMap', card.id)
    },

    updateDimensions: (context, cardId) => {
      utils.typeCheck({ value: cardId, type: 'string', origin: 'updateDimensions', allowUndefined: true })
      let cards = []
      if (cardId) {
        const card = context.getters.byId(cardId)
        if (!card) { return }
        cards.push(card)
      } else {
        cards = context.getters.all
      }
      cards = utils.clone(cards)
      cards = cards.filter(card => Boolean(card))
      cards.forEach(card => {
        const prevDimensions = {
          width: card.width,
          height: card.height
        }
        nextTick(() => {
          card = utils.updateCardDimensions(card)
          const dimensionsChanged = card.width !== prevDimensions.width || card.height !== prevDimensions.height
          if (!dimensionsChanged) { return }
          const body = {
            id: card.id,
            width: Math.ceil(card.width),
            height: Math.ceil(card.height)
          }
          context.dispatch('api/addToQueue', { name: 'updateCard', body }, { root: true })
          context.dispatch('broadcast/update', { updates: body, type: 'updateCard', handler: 'currentCards/update' }, { root: true })
          context.commit('update', body)
        })
      })
    },
    toggleChecked (context, { cardId, value }) {
      utils.typeCheck({ value, type: 'boolean', origin: 'toggleChecked' })
      utils.typeCheck({ value: cardId, type: 'string', origin: 'toggleChecked' })
      const card = context.getters.byId(cardId)
      let name = card.name
      const checkbox = utils.checkboxFromString(name)
      name = name.replace(checkbox, '')
      if (value) {
        name = `[x] ${name}`
      } else {
        name = `[] ${name}`
      }
      context.dispatch('update', {
        id: cardId,
        name,
        nameUpdatedAt: new Date()
      })
    },
    removeChecked: (context, cardId) => {
      utils.typeCheck({ value: cardId, type: 'string', origin: 'removeChecked' })
      const card = context.getters.byId(cardId)
      let name = card.name
      name = name.replace('[x]', '').trim()
      context.dispatch('update', {
        id: cardId,
        name,
        nameUpdatedAt: new Date()
      })
    },
    commentIsVisible: (context, { cardId, value }) => {
      utils.typeCheck({ value: cardId, type: 'string', origin: 'commentIsVisible' })
      context.dispatch('update', {
        id: cardId,
        commentIsVisible: value
      })
      context.dispatch('updateDimensionsAndMap', cardId)
    },

    // resize

    resize: (context, { cardIds, deltaX }) => {
      const minImageWidth = 64
      cardIds.forEach(cardId => {
        const card = context.getters.byId(cardId)
        let width = card.resizeWidth || card.width
        width = width + deltaX
        width = Math.max(minImageWidth, width)
        const updates = { id: cardId, resizeWidth: width }
        context.dispatch('update', updates)
        context.dispatch('broadcast/update', { updates, type: 'resizeCard', handler: 'currentCards/update' }, { root: true })
        context.dispatch('updateDimensionsAndMap', cardId)
      })
    },
    removeResize: (context, { cardIds }) => {
      cardIds.forEach(cardId => {
        const updates = { id: cardId, resizeWidth: null }
        context.dispatch('update', updates)
        context.dispatch('broadcast/update', { updates, type: 'resizeCard', handler: 'currentCards/update' }, { root: true })
        context.dispatch('updateDimensionsAndMap', cardId)
      })
    },

    // move

    moveWhileDragging: (state, cards) => {
      cards.forEach(card => {
        const element = document.querySelector(`article[data-card-id="${card.id}"]`)
        element.style.left = card.x + 'px'
        element.style.top = card.y + 'px'
      })
    },

    move: (context, { endCursor, prevCursor, delta }) => {
      const currentDraggingCardId = context.rootState.currentDraggingCardId
      const multipleCardsSelectedIds = context.rootState.multipleCardsSelectedIds
      const zoom = context.rootGetters.spaceCounterZoomDecimal
      if (!endCursor || !prevCursor) { return }
      endCursor = {
        x: endCursor.x * zoom,
        y: endCursor.y * zoom
      }
      delta = delta || {
        x: endCursor.x - prevCursor.x,
        y: endCursor.y - prevCursor.y
      }
      let cardIds
      let connections = []
      if (multipleCardsSelectedIds.length) {
        cardIds = multipleCardsSelectedIds
      } else {
        cardIds = [currentDraggingCardId]
      }
      let cards = cardIds.map(id => context.getters.byId(id))
      // prevent cards bunching up at 0
      cards.forEach(card => {
        if (!card) { return }
        if (card.x === 0) { delta.x = Math.max(0, delta.x) }
        if (card.y === 0) { delta.y = Math.max(0, delta.y) }
        connections = connections.concat(context.rootGetters['currentConnections/byCardId'](card.id))
      })
      cards = cards.filter(card => Boolean(card))
      // prevent cards with null or negative positions
      cards = utils.clone(cards)
      cards = cards.map(card => {
        const position = utils.cardPositionFromElement(card.id)
        card.x = position.x
        card.y = position.y
        // x
        if (card.x === undefined || card.x === null) {
          delete card.x
        } else {
          card.x = Math.max(0, card.x + delta.x)
          card.x = Math.round(card.x)
        }
        // y
        if (card.y === undefined || card.y === null) {
          delete card.y
        } else {
          card.y = Math.max(0, card.y + delta.y)
          card.y = Math.round(card.y)
        }
        card = {
          x: card.x,
          y: card.y,
          z: card.z,
          id: card.id
        }
        return card
      })
      // update
      context.dispatch('moveWhileDragging', cards)
      connections = uniqBy(connections, 'id')
      context.commit('cardsWereDragged', true, { root: true })
      context.dispatch('currentConnections/updatePathsWhileDragging', { connections, cards }, { root: true })
      context.dispatch('broadcast/update', { updates: { cards }, type: 'moveCards', handler: 'currentCards/moveWhileDraggingBroadcast' }, { root: true })
      context.dispatch('broadcast/update', { updates: { connections }, type: 'updateConnectionPaths', handler: 'currentConnections/updatePathsWhileDraggingBroadcast' }, { root: true })
      connections.forEach(connection => {
        context.dispatch('api/addToQueue', { name: 'updateConnection', body: connection }, { root: true })
      })
    },
    afterMove: (context) => {
      const spaceId = context.rootState.currentSpace.id
      const currentDraggingCardId = context.rootState.currentDraggingCardId
      const multipleCardsSelectedIds = context.rootState.multipleCardsSelectedIds
      let cards
      let connections = []
      if (multipleCardsSelectedIds.length) {
        cards = multipleCardsSelectedIds
      } else {
        cards = [currentDraggingCardId]
      }
      cards = cards.filter(card => card)
      if (!cards.length) { return }
      cards = cards.map(id => {
        let card = context.getters.byId(id)
        if (!card) { return }
        card = utils.clone(card)
        if (!card) { return }
        const position = utils.cardPositionFromElement(id)
        card.x = position.x
        card.y = position.y
        const { x, y, z, commentIsVisible } = card
        return { id, x, y, z, commentIsVisible }
      })
      cards = cards.filter(card => Boolean(card))
      context.commit('move', { cards, spaceId })
      cards = cards.filter(card => card)
      cards.forEach(card => {
        context.dispatch('api/addToQueue', {
          name: 'updateCard',
          body: card
        }, { root: true })
        connections = connections.concat(context.rootGetters['currentConnections/byCardId'](card.id))
      })
      context.dispatch('broadcast/update', { updates: { cards }, type: 'moveCards', handler: 'currentCards/moveBroadcast' }, { root: true })
      connections = uniqBy(connections, 'id')
      context.commit('currentConnections/updatePaths', connections, { root: true })
      context.commit('triggerUpdateConnectionArrowPositions', { connections }, { root: true })
      context.dispatch('broadcast/update', { updates: { connections }, type: 'updateConnectionPaths', handler: 'currentConnections/updatePathsBroadcast' }, { root: true })
      context.dispatch('checkIfShouldIncreasePageSize', { cardId: currentDraggingCardId })
      context.dispatch('history/resume', null, { root: true })
      context.dispatch('history/add', { cards, useSnapshot: true }, { root: true })
      context.dispatch('updateCardMap')
    },
    checkIfShouldIncreasePageSize: (context, { cardId }) => {
      const card = context.getters.byId(cardId)
      if (!card) { return }
      const zoom = context.rootGetters.spaceZoomDecimal
      let thresholdHeight = (context.rootState.viewportHeight * zoom) / 4
      let thresholdWidth = (context.rootState.viewportWidth * zoom) / 4
      const pageWidth = context.rootState.pageWidth
      const pageHeight = context.rootState.pageHeight
      const shouldIncreasePageWidth = (card.x + card.width + thresholdWidth) > pageWidth
      const shouldIncreasePageHeight = (card.y + card.height + thresholdHeight) > pageHeight
      if (shouldIncreasePageWidth) {
        const width = pageWidth + thresholdWidth
        context.commit('pageWidth', width, { root: true })
      }
      if (shouldIncreasePageHeight) {
        const height = pageHeight + thresholdHeight
        context.commit('pageHeight', height, { root: true })
      }
    },

    // z-index

    incrementSelectedZs: (context) => {
      const multipleCardsSelectedIds = context.rootState.multipleCardsSelectedIds
      const currentDraggingCardId = context.rootState.currentDraggingCardId
      if (multipleCardsSelectedIds.length) {
        multipleCardsSelectedIds.forEach(id => context.dispatch('incrementZ', id))
      } else {
        context.dispatch('incrementZ', currentDraggingCardId)
      }
    },
    clearAllZs: (context) => {
      let cards = context.getters.all
      cards.forEach(card => {
        const body = { id: card.id, z: 0 }
        context.commit('update', body)
        context.dispatch('api/addToQueue', { name: 'updateCard', body }, { root: true })
        context.dispatch('broadcast/update', { updates: body, type: 'updateCard', handler: 'currentCards/update' }, { root: true })
      })
    },
    incrementZ: (context, id) => {
      const card = context.getters.byId(id)
      if (!card) { return }
      if (card.isLocked) { return }
      const maxInt = Number.MAX_SAFE_INTEGER - 1000
      let cards = context.getters.all
      let highestCardZ = utils.highestCardZ(cards)
      if (highestCardZ > maxInt) {
        context.dispatch('clearAllZs')
        highestCardZ = 1
      }
      const userCanEdit = context.rootGetters['currentUser/canEditSpace']()
      const body = { id, z: highestCardZ + 1 }
      context.commit('update', body)
      if (!userCanEdit) { return }
      context.dispatch('api/addToQueue', { name: 'updateCard', body }, { root: true })
      context.dispatch('broadcast/update', { updates: body, type: 'updateCard', handler: 'currentCards/update' }, { root: true })
    },

    // remove

    remove: (context, card) => {
      if (!card) { return }
      card = context.getters.byId(card.id)
      const cardHasContent = Boolean(card.name)
      if (cardHasContent) {
        card = utils.clone(card)
        card.isRemoved = true
        context.dispatch('history/add', { cards: [card], isRemoved: true }, { root: true })
        context.commit('remove', card)
        context.dispatch('api/addToQueue', { name: 'removeCard', body: card }, { root: true })
      } else {
        context.dispatch('deleteCard', card)
      }
      context.dispatch('broadcast/update', { updates: card, type: 'removeCard', handler: 'currentCards/remove' }, { root: true })
      context.dispatch('currentConnections/removeFromCard', card, { root: true })
      context.commit('triggerUpdatePositionInVisualViewport', null, { root: true })
      const cardIsUpdatedByCurrentUser = card.userId === context.rootState.currentUser.id
      if (cardIsUpdatedByCurrentUser) {
        context.dispatch('currentUser/cardsCreatedCountUpdateBy', {
          delta: -1
        }, { root: true })
      }
      if (!context.rootGetters['currentUser/cardsCreatedIsOverLimit']) {
        context.commit('notifyCardsCreatedIsOverLimit', false, { root: true })
      }
      context.dispatch('updateCardMap')
      context.commit('triggerUpdateCardOverlaps', null, { root: true })
    },
    deleteCard: (context, card) => {
      context.commit('deleteCard', card)
      context.dispatch('api/addToQueue', { name: 'deleteCard', body: card }, { root: true })
    },
    deleteAllRemoved: (context) => {
      const spaceId = context.rootState.currentSpace.id
      const userId = context.rootState.currentUser.id
      const removedCards = context.state.removedCards
      removedCards.forEach(card => context.commit('deleteCard', card))
      context.dispatch('api/addToQueue', { name: 'deleteAllRemovedCards', body: { userId, spaceId } }, { root: true })
    },
    restoreRemoved: (context, card) => {
      context.commit('restoreRemoved', card)
      context.dispatch('api/addToQueue', { name: 'restoreRemovedCard', body: card }, { root: true })
      context.dispatch('broadcast/update', { updates: card, type: 'restoreRemovedCard', handler: 'currentCards/restoreRemoved' }, { root: true })
      context.dispatch('updateCardMap')
    },

    // card details

    showCardDetails: (context, cardId) => {
      context.dispatch('incrementZ', cardId)
      context.commit('cardDetailsIsVisibleForCardId', cardId, { root: true })
      context.commit('parentCardId', cardId, { root: true })
      context.commit('loadSpaceShowDetailsForCardId', '', { root: true })
    },

    // card map

    updateCardMap: (context) => {
      let cards = context.getters.all
      cards = utils.clone(cards)
      const viewport = utils.visualViewport()
      const zoom = context.rootState.spaceZoomPercent / 100
      updateCardMapDebounced({ cards, viewport, zoom })
    },
    updateDimensionsAndMap: (context, cardId) => {
      nextTick(() => {
        context.dispatch('updateDimensions', cardId)
        context.dispatch('updateCardMap')
        context.dispatch('currentConnections/updatePaths', { cardId, shouldUpdateApi: true }, { root: true })
      })
    }
  },
  getters: {
    byId: (state) => (id) => {
      return state.cards[id]
    },
    all: (state) => {
      return state.ids.map(id => state.cards[id])
    },
    withSpaceLinks: (state, getters) => {
      let cards = getters.all
      return cards.filter(card => utils.idIsValid(card.linkToSpaceId))
    },
    withTagName: (state, getters) => (tagName) => {
      let cards = getters.all
      return cards.filter(card => {
        const tags = utils.tagsFromStringWithoutBrackets(card.name)
        if (tags) {
          return tags.includes(tagName)
        }
      })
    },
    userIds: (state, getters) => {
      const cards = getters.all
      let users = []
      cards.forEach(card => {
        users.push(card.userId)
        users.push(card.nameUpdatedByUserId)
      })
      users = users.filter(user => Boolean(user))
      users = uniq(users)
      return users
    },
    users: (state, getters, rootState, rootGetters) => {
      return getters.userIds.map(id => rootGetters['currentSpace/userById'](id))
    },
    backgroundColors: (state, getters) => {
      const cards = getters.all
      let colors = cards.map(card => card.backgroundColor)
      colors = colors.filter(color => Boolean(color))
      return uniq(colors)
    }
  }
}

export default currentCards
