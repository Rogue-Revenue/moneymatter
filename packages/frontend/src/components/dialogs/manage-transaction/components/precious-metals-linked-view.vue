<script setup lang="ts">
import { Button } from '@/components/lib/ui/button';
import { ROUTES_NAMES } from '@/routes/constants';
import { DialogTitle } from 'reka-ui';

const emit = defineEmits<{ 'close-modal': [] }>();
</script>

<template>
  <div class="rounded-t-xl">
    <div class="bg-app-transfer-color h-3 rounded-t-lg" />
    <div class="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
      <DialogTitle class="text-xl">{{ $t('dialogs.manageTransaction.preciousMetalsLinked.title') }}</DialogTitle>
      <Button variant="ghost" @click="emit('close-modal')">{{
        $t('dialogs.manageTransaction.form.closeButton')
      }}</Button>
    </div>
    <div class="space-y-4 px-6 pb-6">
      <div class="bg-muted/30 space-y-2 rounded-lg border p-4 text-sm">
        <p>{{ $t('dialogs.manageTransaction.preciousMetalsLinked.description') }}</p>
        <p class="text-muted-foreground">{{ $t('dialogs.manageTransaction.preciousMetalsLinked.editHint') }}</p>
      </div>
      <router-link :to="{ name: ROUTES_NAMES.preciousMetals }" class="block" @click="emit('close-modal')"
        ><Button variant="outline" class="w-full">{{
          $t('dialogs.manageTransaction.preciousMetalsLinked.open')
        }}</Button></router-link
      >
    </div>
  </div>
</template>
