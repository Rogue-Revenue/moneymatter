<script setup lang="ts">
import SelectField from '@/components/fields/select-field.vue';
import { useCurrencyName } from '@/composable/formatters';
import { useCurrenciesStore } from '@/stores';
import { computed } from 'vue';

defineProps<{ label: string; placeholder: string; disabled?: boolean }>();
const model = defineModel<string>({ required: true });
const currenciesStore = useCurrenciesStore();
const { formatCurrencyLabel } = useCurrencyName();
const options = computed(() =>
  currenciesStore.systemCurrenciesVerbose.linked.map((currency) => ({
    value: currency.code,
    label: formatCurrencyLabel({ code: currency.code, fallbackName: currency.currency }),
  })),
);
</script>

<template>
  <SelectField
    :model-value="options.find((option) => option.value === model) ?? null"
    :values="options"
    :label="label"
    :placeholder="placeholder"
    :disabled="disabled"
    with-search
    @update:model-value="(option) => option && (model = option.value)"
  />
</template>
