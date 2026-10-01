<script setup lang="ts">
import { createMetalHolding, updateMetalHolding } from '@/api/precious-metals';
import { getErrorMessage } from '@/common/utils/error-message';
import { fractionToPercentInput } from '@/common/utils/percentage';
import InputField from '@/components/fields/input-field.vue';
import SelectField from '@/components/fields/select-field.vue';
import TextareaField from '@/components/fields/textarea-field.vue';
import { Button } from '@/components/lib/ui/button';
import { Checkbox } from '@/components/lib/ui/checkbox';
import { NotificationType, useNotificationCenter } from '@/components/notification-center';
import { useMetalMutation } from '@/composable/data-queries/precious-metals';
import { useCurrenciesStore } from '@/stores';
import {
  PRECIOUS_METALS,
  type MetalHoldingDto,
  type MetalHoldingDetailDto,
  type MetalPhysicalSpec,
  type MetalPricingMode,
} from '@bt/shared/types/precious-metals';
import { utcDayKey } from '@/common/utils/date';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import {
  METAL_EVENT_VALIDATION_KEYS,
  isPositiveMetalDecimal,
  normalizeMetalDecimal,
  parseMetalAmount,
  parseMetalPurity,
  validateMetalEvent,
} from '../utils/forms';
import MetalCurrencyField from './metal-currency-field.vue';
import MetalEventFields from './metal-event-fields.vue';

const props = defineProps<{ holding?: MetalHoldingDto }>();
const emit = defineEmits<{ saved: [holding: MetalHoldingDetailDto]; cancel: [] }>();
const { t } = useI18n();
const { addNotification } = useNotificationCenter();
const currenciesStore = useCurrenciesStore();
const createMutation = useMetalMutation({ mutationFn: createMetalHolding });
const updateMutation = useMetalMutation({ mutationFn: updateMetalHolding });
const pending = computed(() => createMutation.isPending.value || updateMutation.isPending.value);
const form = reactive({
  name: props.holding?.name ?? '',
  metal: (props.holding?.metal ?? 'gold') as MetalPhysicalSpec['metal'],
  form: (props.holding?.form ?? 'coin') as MetalPhysicalSpec['form'],
  currencyCode: props.holding?.currencyCode ?? currenciesStore.baseCurrency?.currencyCode ?? '',
  weightPerItem: props.holding?.weightPerItem ?? '',
  weightUnit: (props.holding?.weightUnit ?? 'troy_oz') as MetalPhysicalSpec['weightUnit'],
  weightBasis: (props.holding?.weightBasis ?? 'fine') as MetalPhysicalSpec['weightBasis'],
  purityPercent: props.holding ? fractionToPercentInput(props.holding.purity) : '99.99',
  pricingMode: (props.holding?.pricingMode ?? 'automatic') as MetalPricingMode,
  storageNotes: props.holding?.storageNotes ?? '',
});
const opening = ref(!props.holding);
const lot = reactive({ quantity: '', date: utcDayKey({ date: new Date() }), amount: '', notes: '' });
const error = ref('');
const metals = computed(() => PRECIOUS_METALS.map((value) => ({ value, label: t(`preciousMetals.metal.${value}`) })));
const forms = computed(() =>
  (['coin', 'bar', 'round'] as const).map((value) => ({ value, label: t(`preciousMetals.form.${value}`) })),
);
const units = computed(() =>
  (['g', 'troy_oz'] as const).map((value) => ({ value, label: t(`preciousMetals.unit.${value}`) })),
);
const bases = computed(() =>
  (['gross', 'fine'] as const).map((value) => ({ value, label: t(`preciousMetals.basis.${value}`) })),
);
const modes = computed(() =>
  (['automatic', 'manual'] as const).map((value) => ({ value, label: t(`preciousMetals.mode.${value}`) })),
);

const submit = async () => {
  if (pending.value) return;
  error.value = '';
  if (!form.name.trim()) {
    error.value = t('forms.validators.preciousMetalsName');
    return;
  }
  if (!form.currencyCode) {
    error.value = t('forms.validators.preciousMetalsCurrency');
    return;
  }
  const purity = parseMetalPurity({ value: form.purityPercent });
  if (!props.holding && (!purity || !isPositiveMetalDecimal({ value: form.weightPerItem }))) {
    error.value = t('forms.validators.preciousMetalsPhysical');
    return;
  }
  if (!props.holding && opening.value) {
    const invalid = validateMetalEvent({ ...lot, type: 'opening', availableQuantity: '0' });
    if (invalid) {
      error.value = t(METAL_EVENT_VALIDATION_KEYS[invalid]);
      return;
    }
  }
  try {
    const editable = {
      name: form.name.trim(),
      storageNotes: form.storageNotes.trim() || null,
      pricingMode: form.pricingMode,
    };
    const saved = props.holding
      ? await updateMutation.mutateAsync({ id: props.holding.id, payload: editable })
      : await createMutation.mutateAsync({
          ...editable,
          metal: form.metal,
          form: form.form,
          currencyCode: form.currencyCode,
          weightPerItem: normalizeMetalDecimal({ value: form.weightPerItem }),
          weightUnit: form.weightUnit,
          weightBasis: form.weightBasis,
          purity: purity!,
          ...(opening.value
            ? {
                openingLot: {
                  date: lot.date,
                  quantity: normalizeMetalDecimal({ value: lot.quantity }),
                  totalAmount: parseMetalAmount({ value: lot.amount }) ?? null,
                  notes: lot.notes.trim() || null,
                },
              }
            : {}),
        });
    addNotification({
      text: t(props.holding ? 'preciousMetals.notifications.updated' : 'preciousMetals.notifications.created'),
      type: NotificationType.success,
    });
    emit('saved', saved);
  } catch (cause) {
    error.value = getErrorMessage(cause, t('errors.preciousMetals.save'));
  }
};
</script>

<template>
  <form class="@container/metal-form grid gap-4" @submit.prevent="submit">
    <InputField
      v-model="form.name"
      :label="$t('preciousMetals.fields.name')"
      :placeholder="$t('preciousMetals.fields.namePlaceholder')"
      :disabled="pending"
    />
    <template v-if="!holding">
      <div class="grid gap-4 @sm/metal-form:grid-cols-2">
        <SelectField
          :model-value="metals.find((option) => option.value === form.metal) ?? null"
          :values="metals"
          :label="$t('preciousMetals.fields.metal')"
          :placeholder="$t('preciousMetals.fields.metalPlaceholder')"
          :disabled="pending"
          @update:model-value="(option) => option && (form.metal = option.value)"
        />
        <SelectField
          :model-value="forms.find((option) => option.value === form.form) ?? null"
          :values="forms"
          :label="$t('preciousMetals.fields.form')"
          :placeholder="$t('preciousMetals.fields.formPlaceholder')"
          :disabled="pending"
          @update:model-value="(option) => option && (form.form = option.value)"
        />
      </div>
      <MetalCurrencyField
        v-model="form.currencyCode"
        :label="$t('preciousMetals.fields.currency')"
        :placeholder="$t('preciousMetals.fields.currencyPlaceholder')"
        :disabled="pending"
      />
      <div class="grid gap-4 @sm/metal-form:grid-cols-2">
        <InputField
          v-model="form.weightPerItem"
          inputmode="decimal"
          :label="$t('preciousMetals.fields.weight')"
          :placeholder="$t('preciousMetals.fields.weightPlaceholder')"
          :disabled="pending"
        />
        <SelectField
          :model-value="units.find((option) => option.value === form.weightUnit) ?? null"
          :values="units"
          :label="$t('preciousMetals.fields.unit')"
          :placeholder="$t('preciousMetals.fields.unitPlaceholder')"
          :disabled="pending"
          @update:model-value="(option) => option && (form.weightUnit = option.value)"
        />
      </div>
      <SelectField
        :model-value="bases.find((option) => option.value === form.weightBasis) ?? null"
        :values="bases"
        :label="$t('preciousMetals.fields.basis')"
        :placeholder="$t('preciousMetals.fields.basisPlaceholder')"
        :disabled="pending"
        @update:model-value="(option) => option && (form.weightBasis = option.value)"
      />
      <InputField
        v-model="form.purityPercent"
        inputmode="decimal"
        :label="$t('preciousMetals.fields.purity')"
        :placeholder="$t('preciousMetals.fields.purityPlaceholder')"
        :disabled="pending"
      />
      <p class="text-muted-foreground -mt-2 text-xs">{{ $t('preciousMetals.fields.purityHint') }}</p>
    </template>
    <p v-else class="text-muted-foreground text-sm">{{ $t('preciousMetals.notice.immutable') }}</p>
    <SelectField
      :model-value="modes.find((option) => option.value === form.pricingMode) ?? null"
      :values="modes"
      :label="$t('preciousMetals.fields.pricing')"
      :placeholder="$t('preciousMetals.fields.pricingPlaceholder')"
      :disabled="pending"
      @update:model-value="(option) => option && (form.pricingMode = option.value)"
    />
    <TextareaField
      v-model="form.storageNotes"
      :label="$t('preciousMetals.fields.storage')"
      :placeholder="$t('preciousMetals.fields.storagePlaceholder')"
      :disabled="pending"
    />
    <template v-if="!holding">
      <label class="flex items-center gap-2 text-sm"
        ><Checkbox v-model="opening" :disabled="pending" />{{ $t('preciousMetals.fields.opening') }}</label
      >
      <p class="text-muted-foreground text-xs">{{ $t('preciousMetals.fields.openingHint') }}</p>
      <MetalEventFields
        v-if="opening"
        v-model:quantity="lot.quantity"
        v-model:date="lot.date"
        v-model:amount="lot.amount"
        v-model:notes="lot.notes"
        type="opening"
        :currency-code="form.currencyCode"
        :disabled="pending"
      />
    </template>
    <p v-if="error" role="alert" class="text-destructive-text text-sm">{{ error }}</p>
    <div class="flex justify-end gap-2">
      <Button type="button" variant="outline" :disabled="pending" @click="emit('cancel')">{{
        $t('common.actions.cancel')
      }}</Button
      ><Button type="submit" :disabled="pending" :loading="pending">{{ $t('common.actions.save') }}</Button>
    </div>
  </form>
</template>
