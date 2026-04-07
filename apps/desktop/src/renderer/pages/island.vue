<script setup lang="ts">
import CodingIsland from '../components/island/CodingIsland.vue'
</script>

<template>
  <div class="island-page">
    <CodingIsland />
  </div>
</template>

<style scoped>
.island-page {
  display: flex;
  height: 100%;
  width: 100%;
  align-items: flex-start;
  justify-content: center;
  overflow: visible;
  background: transparent;
  padding-top: 0;
}
</style>

<route lang="yaml">
meta:
  layout: stage
</route>
