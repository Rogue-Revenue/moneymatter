<script setup lang="ts">
import InputField from '@/components/fields/input-field.vue';
import TextareaField from '@/components/fields/textarea-field.vue';
import type { MetalEventType } from '@bt/shared/types/precious-metals';
import { utcDayKey } from '@/common/utils/date';

defineProps<{ type: MetalEventType; disabled?: boolean; currencyCode: string }>();
const quantity = defineModel<string>('quantity', { required: true });
const date = defineModel<string>('date', { required: true });
const amount = defineModel<string>('amount', { required: true });
const notes = defineModel<string>('notes', { required: true });
const today = utcDayKey({ date: new Date() });
</script>

<template>
  <div class="grid gap-4">
    <div class="grid gap-4 @sm/metal-form:grid-cols-2">
      <InputField
        v-model="quantity"
        inputmode="decimal"
        :label="$t('preciousMetals.fields.quantity')"
        :placeholder="$t('preciousMetals.fields.quantityPlaceholder')"
        :disabled="disabled"
      />
      <InputField
        v-model="date"
        type="date"
        :max="today"
        :label="$t('preciousMetals.fields.date')"
        :placeholder="$t('preciousMetals.fields.datePlaceholder')"
        :disabled="disabled"
      />
    </div>
    <InputField
      v-model="amount"
      inputmode="decimal"
      :label="`${$t(type === 'sale' ? 'preciousMetals.fields.proceeds' : 'preciousMetals.fields.cost')} (${currencyCode})`"
      :placeholder="
        $t(type === 'sale' ? 'preciousMetals.fields.proceedsPlaceholder' : 'preciousMetals.fields.costPlaceholder')
      "
      :disabled="disabled"
    />
    <p class="text-muted-foreground -mt-2 text-xs">
      {{ $t(type === 'sale' ? 'preciousMetals.fields.proceedsHint' : 'preciousMetals.fields.costHint') }}
    </p>
    <TextareaField
      v-model="notes"
      :label="$t('preciousMetals.fields.notes')"
      :placeholder="$t('preciousMetals.fields.notesPlaceholder')"
      :disabled="disabled"
    />
  </div>
</template>
