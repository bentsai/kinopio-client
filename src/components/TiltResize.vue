<script setup>
import utils from '@/utils.js'
import consts from '@/consts.js'

import { reactive, computed, onMounted, watch, ref, nextTick } from 'vue'
import { useStore } from 'vuex'
const store = useStore()

const props = defineProps({
  visible: Boolean,
  card: Object
})

const isPresentationMode = computed(() => store.state.isPresentationMode)

// both

const start = (event, action) => {
  if (utils.isMultiTouch(event)) { return }
  store.dispatch('history/pause')
  store.dispatch('closeAllDialogs')
  store.commit('preventDraggedCardFromShowingDetails', true)
  store.dispatch('currentCards/incrementZ', props.card.id)
  let cardIds = [props.card.id]
  const multipleCardsSelectedIds = store.state.multipleCardsSelectedIds
  if (multipleCardsSelectedIds.includes(props.card.id)) {
    cardIds = multipleCardsSelectedIds
  } else {
    store.commit('clearMultipleSelected')
  }
  const updates = {
    userId: store.state.currentUser.id,
    cardIds
  }
  if (action === 'resize') {
    store.commit('currentUserIsResizingCard', true)
    store.commit('currentUserIsResizingCardIds', cardIds)
    store.commit('broadcast/updateStore', { updates, type: 'updateRemoteUserResizingCards' })
  } else if (action === 'tilt') {
    store.commit('currentUserIsTiltingCard', true)
    store.commit('currentUserIsTiltingCardIds', cardIds)
    store.commit('broadcast/updateStore', { updates, type: 'updateRemoteUserTiltingCards' })
  }
}
const remove = (action) => {
  let cardIds = [props.card.id]
  if (store.state.multipleCardsSelectedIds.length) {
    cardIds = store.state.multipleCardsSelectedIds
  }
  if (action === 'resize') {
    store.dispatch('currentCards/removeResize', { cardIds, shouldRemoveResizeWidth: true })
  } else if (action === 'tilt') {
    store.dispatch('currentCards/removeTilt', { cardIds })
  }
}
const colorClass = computed(() => {
  if (!props.card.backgroundColor) { return }
  const colorClass = utils.colorClasses({ backgroundColor: props.card.backgroundColor })
  return [colorClass]
})

// tilt

const tiltIsVisible = computed(() => {
  if (utils.isMobile()) { return }
  const minCardWidth = consts.defaultCardWidth + 10
  const cardIsWideEnough = props.card.width >= minCardWidth
  return props.visible && cardIsWideEnough
})
const isTilting = computed(() => {
  const cardIds = store.state.currentUserIsTiltingCardIds
  if (!cardIds.length) { return }
  return cardIds.includes(props.card.id)
})

// resize

const isComment = computed(() => store.getters['currentCards/isComment'](props.card))
const resizeIsVisible = computed(() => {
  return props.visible && !isComment.value
})
const isResizing = computed(() => {
  const cardIds = store.state.currentUserIsResizingCardIds
  if (!cardIds.length) { return }
  return cardIds.includes(props.card.id)
})
</script>

<template lang="pug">
//- resize
.right-resize.bottom-button-wrap(v-if="resizeIsVisible")
  .inline-button-wrap(
    @mousedown.left.stop="start($event, 'resize')"
    @touchstart.stop="start($event, 'resize')"
    @dblclick="remove('resize')"
    title="Drag to Resize"
  )
    button.inline-button(tabindex="-1" :class="{hidden: isPresentationMode, active: isResizing}")
      img.icon(src="@/assets/resize-corner.svg" :class="colorClass")
//- tilt
.left-tilt.bottom-button-wrap(v-if="tiltIsVisible")
  .inline-button-wrap(
    @mousedown.left.stop="start($event, 'tilt')"
    @touchstart.stop="start($event, 'tilt')"
    @dblclick="remove('tilt')"
    title="Drag to Tilt"
  )
    button.inline-button(tabindex="-1" :class="{hidden: isPresentationMode, active: isTilting}")
      img.icon(src="@/assets/resize-corner.svg" :class="colorClass")
</template>

<style lang="stylus">
.bottom-button-wrap
  pointer-events all
  position absolute
  right -5px
  bottom 2px
  display flex
  .inline-button-wrap
    // background teal
    padding-top 0
    padding-bottom 0
    z-index 1
    cursor ew-resize
    button
      cursor ew-resize
      box-shadow none
    &:hover
      button
        box-shadow none
        background var(--light-shadow) !important
    &.active,
    &:active
      button
        box-shadow none
        background var(--heavy-shadow) !important
  .icon
    -webkit-user-drag none
    user-drag none
    position absolute
    left 0
    top 0

  // tilt
  &.left-tilt
    right initial
    left -5px
    .inline-button-wrap
      padding-right 0
      transform translate(-8px, 13px)
      cursor nwse-resize
      button
        cursor nwse-resize
        transform scaleX(-1)
  // resize
  &.right-resize
    .inline-button-wrap
      padding-left 0
</style>
