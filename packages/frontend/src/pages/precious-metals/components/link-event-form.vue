<script setup lang="ts">
import { linkMetalEvent } from '@/api/precious-metals';
import { getErrorMessage } from '@/common/utils/error-message';
import PickTransactionDialog from '@/components/dialogs/pick-transaction-dialog.vue';
import { Button } from '@/components/lib/ui/button';
import { NotificationType, useNotificationCenter } from '@/components/notification-center';
import { useMetalMutation } from '@/composable/data-queries/precious-metals';
import { useFormatCurrency } from '@/composable/formatters';
import { TRANSACTION_TYPES, type TransactionModel } from '@bt/shared/types';
import type { MetalEventDto } from '@bt/shared/types/precious-metals';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { getMetalLinkError } from '../utils/forms';

const props = defineProps<{ holdingId: string; event: MetalEventDto }>();
const emit = defineEmits<{ saved: []; cancel: [] }>();
const { t } = useI18n();
const { formatAmountByCurrencyCode } = useFormatCurrency();
const { addNotification } = useNotificationCenter();
const mutation = useMetalMutation({ mutationFn: linkMetalEvent });
const pickerOpen = ref(false);
const selected = ref<TransactionModel | null>(null);
const error = ref('');

const pick = (transaction: TransactionModel) => {
  const invalid = getMetalLinkError({ transaction, event: props.event });
  if (invalid) {
    error.value = t(`preciousMetals.link.${invalid}`);
    return;
  }
  selected.value = transaction;
  error.value = '';
};

const submit = async () => {
  if (!selected.value || mutation.isPending.value) return;
  try {
    await mutation.mutateAsync({ id: props.holdingId, eventId: props.event.id, transactionId: selected.value.id });
    addNotification({ text: t('preciousMetals.link.linked'), type: NotificationType.success });
    emit('saved');
  } catch (cause) {
    error.value = getErrorMessage(cause, t('errors.preciousMetals.save'));
  }
};
</script>

<template>
  <form class="grid gap-4" @submit.prevent="submit">
    <p class="text-muted-foreground text-sm">{{ $t('preciousMetals.link.description') }}</p>
    <p class="text-sm">
      {{
        event.totalAmount === null
          ? $t('preciousMetals.link.unknownAmount')
          : formatAmountByCurrencyCode(event.totalAmount, event.currencyCode)
      }}
    </p>
    <Button
      type="button"
      variant="outline"
      :disabled="mutation.isPending.value || event.totalAmount === null"
      @click="pickerOpen = true"
      >{{ $t('preciousMetals.actions.pick') }}</Button
    >
    <p v-if="selected" class="text-sm">
      {{
        $t('preciousMetals.link.selected', {
          amount: formatAmountByCurrencyCode(selected.amount, selected.currencyCode),
        })
      }}
    </p>
    <p v-if="error" role="alert" class="text-destructive-text text-sm">{{ error }}</p>
    <div class="flex justify-end gap-2">
      <Button type="button" variant="outline" :disabled="mutation.isPending.value" @click="emit('cancel')">{{
        $t('common.actions.cancel')
      }}</Button
      ><Button type="submit" :disabled="!selected || mutation.isPending.value" :loading="mutation.isPending.value">{{
        $t('preciousMetals.actions.link')
      }}</Button>
    </div>
    <PickTransactionDialog
      v-if="pickerOpen"
      v-model:open="pickerOpen"
      :transaction-type="event.type === 'sale' ? TRANSACTION_TYPES.income : TRANSACTION_TYPES.expense"
      @select="pick"
    />
  </form>
</template>
