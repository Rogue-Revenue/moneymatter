<script setup lang="ts">
import { createMetalEvent } from '@/api/precious-metals';
import { getErrorMessage } from '@/common/utils/error-message';
import PickTransactionDialog from '@/components/dialogs/pick-transaction-dialog.vue';
import { Button } from '@/components/lib/ui/button';
import { NotificationType, useNotificationCenter } from '@/components/notification-center';
import { useMetalMutation } from '@/composable/data-queries/precious-metals';
import { useFormatCurrency } from '@/composable/formatters';
import { TRANSACTION_TYPES, type TransactionModel } from '@bt/shared/types';
import type { MetalEventType, MetalHoldingDto } from '@bt/shared/types/precious-metals';
import { utcDayKey } from '@/common/utils/date';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import {
  METAL_EVENT_VALIDATION_KEYS,
  getMetalLinkError,
  normalizeMetalDecimal,
  parseMetalAmount,
  validateMetalEvent,
} from '../utils/forms';
import MetalEventFields from './metal-event-fields.vue';

const props = defineProps<{ holding: MetalHoldingDto; type: MetalEventType }>();
const emit = defineEmits<{ saved: []; cancel: [] }>();
const { t } = useI18n();
const { addNotification } = useNotificationCenter();
const { formatAmountByCurrencyCode } = useFormatCurrency();
const mutation = useMetalMutation({ mutationFn: createMetalEvent });
const form = reactive({ quantity: '', date: utcDayKey({ date: new Date() }), amount: '', notes: '' });
const selected = ref<TransactionModel | null>(null);
const pickerOpen = ref(false);
const error = ref('');
const totalAmount = computed(() => parseMetalAmount({ value: form.amount }));

const pickTransaction = (transaction: TransactionModel) => {
  const invalid = getMetalLinkError({
    transaction,
    event: { type: props.type, currencyCode: props.holding.currencyCode, totalAmount: totalAmount.value ?? null },
  });
  if (invalid) {
    error.value = t(`preciousMetals.link.${invalid}`);
    return;
  }
  selected.value = transaction;
  error.value = '';
};

const submit = async () => {
  if (mutation.isPending.value) return;
  error.value = '';
  const invalid = validateMetalEvent({
    ...form,
    type: props.type,
    availableQuantity: props.holding.valuation.quantity,
  });
  if (invalid) {
    error.value = t(METAL_EVENT_VALIDATION_KEYS[invalid]);
    return;
  }
  if (selected.value) {
    const linkError = getMetalLinkError({
      transaction: selected.value,
      event: { type: props.type, currencyCode: props.holding.currencyCode, totalAmount: totalAmount.value ?? null },
    });
    if (linkError) {
      error.value = t(`preciousMetals.link.${linkError}`);
      return;
    }
  }
  try {
    await mutation.mutateAsync({
      id: props.holding.id,
      payload: {
        type: props.type,
        date: form.date,
        quantity: normalizeMetalDecimal({ value: form.quantity }),
        totalAmount: totalAmount.value ?? null,
        notes: form.notes.trim() || null,
        transactionId: selected.value?.id ?? null,
      },
    });
    addNotification({ text: t('preciousMetals.notifications.event'), type: NotificationType.success });
    emit('saved');
  } catch (cause) {
    error.value = getErrorMessage(cause, t('errors.preciousMetals.save'));
  }
};
</script>

<template>
  <form class="@container/metal-form grid gap-4" @submit.prevent="submit">
    <p class="text-muted-foreground text-sm">{{ $t('preciousMetals.notice.cash') }}</p>
    <p v-if="type === 'sale'" class="text-sm">
      {{ $t('preciousMetals.fields.available', { quantity: holding.valuation.quantity }) }}
    </p>
    <MetalEventFields
      v-model:quantity="form.quantity"
      v-model:date="form.date"
      v-model:amount="form.amount"
      v-model:notes="form.notes"
      :type="type"
      :currency-code="holding.currencyCode"
      :disabled="mutation.isPending.value"
    />
    <div v-if="type !== 'opening'" class="grid gap-2">
      <p v-if="selected" class="text-sm">
        {{
          $t('preciousMetals.link.selected', {
            amount: formatAmountByCurrencyCode(selected.amount, selected.currencyCode),
          })
        }}
      </p>
      <div class="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          :disabled="mutation.isPending.value || totalAmount == null"
          @click="pickerOpen = true"
          >{{ $t('preciousMetals.actions.pick') }}</Button
        >
        <Button
          v-if="selected"
          type="button"
          variant="ghost"
          :disabled="mutation.isPending.value"
          @click="selected = null"
          >{{ $t('common.components.selectField.clearSelection') }}</Button
        >
      </div>
      <p v-if="totalAmount == null" class="text-muted-foreground text-xs">
        {{ $t('preciousMetals.link.unknownAmount') }}
      </p>
    </div>
    <p v-if="error" role="alert" class="text-destructive-text text-sm">{{ error }}</p>
    <div class="flex justify-end gap-2">
      <Button type="button" variant="outline" :disabled="mutation.isPending.value" @click="emit('cancel')">{{
        $t('common.actions.cancel')
      }}</Button
      ><Button type="submit" :disabled="mutation.isPending.value" :loading="mutation.isPending.value">{{
        $t('common.actions.save')
      }}</Button>
    </div>
    <PickTransactionDialog
      v-if="pickerOpen"
      v-model:open="pickerOpen"
      :transaction-type="type === 'sale' ? TRANSACTION_TYPES.income : TRANSACTION_TYPES.expense"
      @select="pickTransaction"
    />
  </form>
</template>
