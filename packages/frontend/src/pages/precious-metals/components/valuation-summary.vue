<script setup lang="ts">
import { useDateLocale } from '@/composable/use-date-locale';
import PrecisionNumber from '@/components/common/precision-number.vue';
import { useFormatCurrency } from '@/composable/formatters';
import { cn } from '@/lib/utils';
import type { MetalValuationDto } from '@bt/shared/types/precious-metals';
import { ClockAlertIcon } from '@lucide/vue';

defineProps<{ valuation: MetalValuationDto; compact?: boolean }>();
const { formatAmountByCurrencyCode } = useFormatCurrency();
const { format: formatQuoteTime } = useDateLocale();
</script>

<template>
  <div class="@container/metal-value grid gap-4">
    <div>
      <p class="text-muted-foreground text-xs">{{ $t('preciousMetals.valuation.spot') }}</p>
      <p class="mt-1 text-2xl font-semibold tabular-nums">
        {{
          valuation.spotValue === null
            ? $t('common.labels.unknown')
            : formatAmountByCurrencyCode(valuation.spotValue, valuation.currencyCode)
        }}
      </p>
      <p
        :class="
          cn(
            'mt-1 flex items-center gap-1 text-xs',
            ['stale', 'missing_price', 'missing_fx'].includes(valuation.status)
              ? 'text-warning-text'
              : 'text-muted-foreground',
          )
        "
      >
        <ClockAlertIcon v-if="valuation.status === 'stale'" class="size-3.5" />
        {{ $t(`preciousMetals.status.${valuation.status}`) }}
      </p>
    </div>
    <dl class="grid grid-cols-2 gap-4 @md/metal-value:grid-cols-3">
      <div>
        <dt class="text-muted-foreground text-xs">{{ $t('preciousMetals.valuation.quantity') }}</dt>
        <dd class="mt-1 tabular-nums"><PrecisionNumber :value="valuation.quantity" :max-decimals="6" /></dd>
      </div>
      <div>
        <dt class="text-muted-foreground text-xs">{{ $t('preciousMetals.valuation.fineGrams') }}</dt>
        <dd class="mt-1 tabular-nums"><PrecisionNumber :value="valuation.fineGrams" :max-decimals="6" /></dd>
      </div>
      <div>
        <dt class="text-muted-foreground text-xs">{{ $t('preciousMetals.valuation.fineOz') }}</dt>
        <dd class="mt-1 tabular-nums"><PrecisionNumber :value="valuation.fineTroyOunces" :max-decimals="6" /></dd>
      </div>
      <template v-if="!compact">
        <div>
          <dt class="text-muted-foreground text-xs">
            {{
              $t(valuation.costBasisComplete ? 'preciousMetals.valuation.cost' : 'preciousMetals.valuation.knownCost')
            }}
          </dt>
          <dd class="mt-1 tabular-nums">
            {{ formatAmountByCurrencyCode(valuation.knownCostBasis, valuation.currencyCode) }}
          </dd>
        </div>
        <div>
          <dt class="text-muted-foreground text-xs">{{ $t('preciousMetals.valuation.unrealized') }}</dt>
          <dd
            :class="
              cn(
                'mt-1 tabular-nums',
                valuation.unrealizedGain !== null &&
                  (valuation.unrealizedGain >= 0 ? 'text-app-income-color' : 'text-app-expense-color'),
              )
            "
          >
            {{
              valuation.unrealizedGain === null
                ? $t('common.labels.unknown')
                : formatAmountByCurrencyCode(valuation.unrealizedGain, valuation.currencyCode)
            }}
          </dd>
        </div>
        <div>
          <dt class="text-muted-foreground text-xs">{{ $t('preciousMetals.valuation.realized') }}</dt>
          <dd
            :class="
              cn(
                'mt-1 tabular-nums',
                valuation.realizedGain !== null &&
                  (valuation.realizedGain >= 0 ? 'text-app-income-color' : 'text-app-expense-color'),
              )
            "
          >
            {{
              valuation.realizedGain === null
                ? $t('common.labels.unknown')
                : formatAmountByCurrencyCode(valuation.realizedGain, valuation.currencyCode)
            }}
          </dd>
        </div>
      </template>
    </dl>
    <div v-if="!valuation.costBasisComplete" class="text-warning-text space-y-1 text-xs">
      <p>{{ $t('preciousMetals.valuation.unknownQuantity', { quantity: valuation.unknownCostQuantity }) }}</p>
      <p v-if="!compact">{{ $t('preciousMetals.notice.unknown') }}</p>
    </div>
    <div v-if="valuation.quote" class="text-muted-foreground border-border space-y-1 border-t pt-3 text-xs">
      <p>
        {{
          $t('preciousMetals.valuation.source', {
            source: valuation.quote.isManual ? $t('preciousMetals.valuation.manualSource') : valuation.quote.source,
          })
        }}
      </p>
      <p>
        {{
          $t('preciousMetals.valuation.asOf', {
            date: formatQuoteTime(valuation.quote.asOf, 'd MMM yyyy, HH:mm:ss xxx'),
          })
        }}
        · {{ $t('preciousMetals.valuation.quoteCurrency', { currency: valuation.quote.currencyCode }) }}
      </p>
      <p v-if="!compact">
        {{ $t('preciousMetals.valuation.price') }}:
        {{ formatAmountByCurrencyCode(valuation.quote.pricePerTroyOz, valuation.quote.currencyCode) }}
      </p>
      <p v-if="valuation.quote.isStale" class="text-warning-text">{{ $t('preciousMetals.valuation.stale') }}</p>
    </div>
    <p v-if="valuation.status === 'missing_fx' && !compact" class="text-warning-text text-xs">
      {{ $t('preciousMetals.valuation.missingFx') }}
    </p>
  </div>
</template>
