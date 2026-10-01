<script setup lang="ts">
import { createMetalQuote } from '@/api/precious-metals';
import { getErrorMessage } from '@/common/utils/error-message';
import InputField from '@/components/fields/input-field.vue';
import { Button } from '@/components/lib/ui/button';
import { NotificationType, useNotificationCenter } from '@/components/notification-center';
import { useMetalMutation } from '@/composable/data-queries/precious-metals';
import type { MetalHoldingDto } from '@bt/shared/types/precious-metals';
import { utcDayKey } from '@/common/utils/date';
import { reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { parseMetalAmount, validateMetalEvent } from '../utils/forms';
import MetalCurrencyField from './metal-currency-field.vue';

const props = defineProps<{ holding: MetalHoldingDto }>();
const emit = defineEmits<{ saved: []; cancel: [] }>();
const { t } = useI18n();
const { addNotification } = useNotificationCenter();
const mutation = useMetalMutation({ mutationFn: createMetalQuote });
const today = utcDayKey({ date: new Date() });
const form = reactive({ price: '', currencyCode: props.holding.currencyCode, asOf: today });
const error = ref('');

const submit = async () => {
  if (mutation.isPending.value) return;
  const invalidDate = validateMetalEvent({
    type: 'opening',
    date: form.asOf,
    quantity: '1',
    amount: '',
    availableQuantity: '0',
  });
  const price = parseMetalAmount({ value: form.price });
  if (price == null || price <= 0 || invalidDate || !form.currencyCode) {
    error.value = t('forms.validators.preciousMetalsPrice');
    return;
  }
  error.value = '';
  try {
    await mutation.mutateAsync({
      id: props.holding.id,
      payload: { pricePerTroyOz: price, currencyCode: form.currencyCode, asOf: `${form.asOf}T00:00:00.000Z` },
    });
    addNotification({ text: t('preciousMetals.notifications.quote'), type: NotificationType.success });
    emit('saved');
  } catch (cause) {
    error.value = getErrorMessage(cause, t('errors.preciousMetals.save'));
  }
};
</script>

<template>
  <form class="grid gap-4" @submit.prevent="submit">
    <p class="text-muted-foreground text-sm">{{ $t('preciousMetals.notice.manual') }}</p>
    <InputField
      v-model="form.price"
      inputmode="decimal"
      :label="$t('preciousMetals.fields.price')"
      :placeholder="$t('preciousMetals.fields.pricePlaceholder')"
      :disabled="mutation.isPending.value"
    />
    <MetalCurrencyField
      v-model="form.currencyCode"
      :label="$t('preciousMetals.fields.quoteCurrency')"
      :placeholder="$t('preciousMetals.fields.quoteCurrencyPlaceholder')"
      :disabled="mutation.isPending.value"
    />
    <InputField
      v-model="form.asOf"
      type="date"
      :max="today"
      :label="$t('preciousMetals.fields.asOf')"
      :placeholder="$t('preciousMetals.fields.asOfPlaceholder')"
      :disabled="mutation.isPending.value"
    />
    <p v-if="error" role="alert" class="text-destructive-text text-sm">{{ error }}</p>
    <div class="flex justify-end gap-2">
      <Button type="button" variant="outline" :disabled="mutation.isPending.value" @click="emit('cancel')">{{
        $t('common.actions.cancel')
      }}</Button
      ><Button type="submit" :disabled="mutation.isPending.value" :loading="mutation.isPending.value">{{
        $t('common.actions.save')
      }}</Button>
    </div>
  </form>
</template>
