<script setup>
import { reactive, computed, onMounted, onBeforeUnmount, onUnmounted, watch, ref, nextTick } from 'vue'
import { useStore } from 'vuex'

import utils from '@/utils.js'

import { nanoid } from 'nanoid'
const store = useStore()

let prevType

onMounted(() => {
  store.subscribe((mutation, state) => {
    if (mutation.type === 'triggerDrawConnectionFrame') {
      const event = mutation.payload
      drawCurrentConnection(event)
    } else if (mutation.type === 'closeAllDialogs') {
      if (isDrawingConnection.value) {
        store.commit('currentUserIsDrawingConnection', false)
        store.dispatch('currentConnections/removeUnusedTypes')
      }
    }
  })
  window.addEventListener('mousemove', interact)
  window.addEventListener('touchmove', interact)
  window.addEventListener('mouseup', stopInteractions)
  window.addEventListener('touchend', stopInteractions)
})

onBeforeUnmount(() => {
  window.removeEventListener('mousemove', interact)
  window.removeEventListener('touchmove', interact)
  window.removeEventListener('mouseup', stopInteractions)
  window.removeEventListener('touchend', stopInteractions)
})

const props = defineProps({
  startItemId: String
})
const state = reactive({
  currentConnectionPath: undefined,
  currentConnectionColor: undefined
})

// drawing

const interact = (event) => {
  if (isDrawingConnection.value) {
    drawCurrentConnection(event)
  }
}
const isDrawingConnection = computed(() => store.state.currentUserIsDrawingConnection)
const drawCurrentConnection = (event) => {
  const end = utils.cursorPositionInSpace(event)
  let start = utils.connectorCoords(props.startItemId)
  start = utils.cursorPositionInSpace(null, start)
  const controlPoint = store.state.currentUser.defaultConnectionControlPoint
  const path = store.getters['currentConnections/connectionPathBetweenCoords'](start, end, controlPoint)
  checkCurrentConnectionSuccess(event)
  state.currentConnectionPath = path
  const connectionType = store.getters['currentConnections/typeForNewConnections']
  prevType = connectionType
  state.currentConnectionColor = connectionType.color
  store.commit('currentConnectionColor', connectionType.color)
  const updates = {
    userId: store.state.currentUser.id,
    connectionTypeId: connectionType.id,
    color: connectionType.color,
    startItemId: props.startItemId,
    path
  }
  store.commit('broadcast/updateStore', { updates, type: 'updateRemoteCurrentConnection' })
}

// connect to item

const checkCurrentConnectionSuccess = (event) => {
  if (!event) { return }
  const position = utils.cursorPositionInViewport(event)
  const cardElement = utils.cardElementFromPosition(position.x, position.y)
  const boxElement = utils.boxElementFromConnectorPosition(position.x, position.y)
  const updates = { userId: store.state.currentUser.id }
  let isCurrentConnectionConnected
  if (cardElement) {
    isCurrentConnectionConnected = props.startItemId !== cardElement.dataset.cardId
  }
  if (boxElement) {
    isCurrentConnectionConnected = props.startItemId !== boxElement.dataset.boxId
  }
  // not connected
  if (!cardElement && !boxElement) {
    store.commit('currentConnectionSuccess', {})
    updates.endItemId = null
    store.commit('broadcast/updateStore', { updates, type: 'updateRemoteCurrentConnection' })
  // connected to card
  } else if (isCurrentConnectionConnected && cardElement) {
    const card = store.getters['currentCards/byId'](cardElement.dataset.cardId)
    if (card.isLocked) {
      store.commit('currentConnectionSuccess', {})
      return
    }
    store.commit('currentConnectionSuccess', card)
    updates.endItemId = card.id
    store.commit('broadcast/updateStore', { updates, type: 'updateRemoteCurrentConnection' })
  // connected to box
  } else if (isCurrentConnectionConnected && boxElement) {
    const box = store.getters['currentBoxes/byId'](boxElement.dataset.boxId)
    if (box.isLocked) {
      store.commit('currentConnectionSuccess', {})
      return
    }
    store.commit('currentConnectionSuccess', box)
    updates.endItemId = box.id
    store.commit('broadcast/updateStore', { updates, type: 'updateRemoteCurrentConnection' })
  } else {
    store.commit('currentConnectionSuccess', {})
  }
}
const addConnections = async (event) => {
  const currentConnectionSuccess = store.state.currentConnectionSuccess
  const startItemIds = store.state.currentConnectionStartItemIds
  let endItemId, estimatedEndItemConnectorPosition
  let position = utils.cursorPositionInSpace(event)
  const shouldPreventCreate = utils.isPositionOutsideOfSpace(position)
  if (shouldPreventCreate) {
    position = utils.cursorPositionInPage(event)
    store.commit('addNotificationWithPosition', { message: 'Outside Space', position, type: 'info', icon: 'cancel', layer: 'app' })
    return
  }
  if (currentConnectionSuccess.id) {
    endItemId = currentConnectionSuccess.id
  } else {
    // create new card
    const startItem = store.getters['currentSpace/itemById'](startItemIds[0])
    const color = startItem.color || startItem.backgroundColor
    endItemId = nanoid()
    const newCard = { position, id: endItemId, isParentCard: true, backgroundColor: color }
    store.dispatch('currentCards/add', { card: newCard })
    store.commit('childCardId', '')
    estimatedEndItemConnectorPosition = utils.estimatedNewCardConnectorPosition(position)
  }
  // create connections to endItemId
  await nextTick()
  startItemIds.forEach(startItemId => {
    store.dispatch('currentCards/updateDimensions', { cards: [{ id: startItemId }] })
    const controlPoint = store.state.currentUser.defaultConnectionControlPoint
    const path = store.getters['currentConnections/connectionPathBetweenItems']({
      startItemId,
      endItemId,
      controlPoint,
      estimatedEndItemConnectorPosition
    })
    const connection = { startItemId, endItemId, path, controlPoint }
    store.dispatch('currentConnections/add', { connection, type: prevType })
  })
}

// stop drawing

const stopInteractions = (event) => {
  if (isDrawingConnection.value) {
    store.dispatch('clearMultipleSelected')
    addConnections(event)
  }
  store.commit('currentConnectionSuccess', {})
  const isCurrentConnection = store.state.currentConnectionStartItemIds.length
  if (isCurrentConnection) {
    store.commit('currentConnectionStartItemIds', [])
    const updates = { userId: store.state.currentUser.id }
    store.commit('broadcast/updateStore', { updates, type: 'removeRemoteCurrentConnection' })
  }
  store.commit('currentUserIsDrawingConnection', false)
  state.currentConnectionPath = undefined
}

// styles and position

const normalizedConnectionPathRect = () => {
  const path = state.currentConnectionPath
  if (!path) { return }
  const rect = utils.rectFromConnectionPath(path)
  return rect
}
const connectionStyles = computed(() => {
  const rect = normalizedConnectionPathRect()
  if (!rect) { return }
  const styles = {
    left: rect.x + 'px',
    top: rect.y + 'px',
    width: rect.width + 'px',
    height: rect.height + 'px'
  }
  if (store.state.currentUserIsDraggingCard) {
    styles.pointerEvents = 'none'
  }
  return styles
})
const connectionPathStyles = computed(() => {
  const rect = normalizedConnectionPathRect()
  if (!rect) { return }
  const styles = {
    transform: `translate(${-rect.x}px,${-rect.y}px)`
  }
  return styles
})

</script>

<template lang="pug">
svg.current-connection(:style="connectionStyles")
  path.current-connection-path(
    v-if="isDrawingConnection"
    fill="none"
    stroke-width="5"
    :stroke="state.currentConnectionColor"
    stroke-linecap="round"
    :d="state.currentConnectionPath"
    :style="connectionPathStyles"
  )
</template>

<style lang="stylus">
svg.current-connection
  position absolute
  min-width 5px
  min-height 5px
  path.current-connection-path
    pointer-events none
</style>
