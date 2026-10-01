<script setup lang="ts">
import { refreshMetalPrices } from '@/api/precious-metals';
import { getErrorMessage } from '@/common/utils/error-message';
import PrecisionNumber from '@/components/common/precision-number.vue';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import { Button } from '@/components/lib/ui/button';
import { Card, CardContent } from '@/components/lib/ui/card';
import { NotificationType, useNotificationCenter } from '@/components/notification-center';
import { useMetalMutation, useMetalsOverview } from '@/composable/data-queries/precious-metals';
import { ROUTES_NAMES } from '@/routes/constants';
import type { MetalHoldingDetailDto } from '@bt/shared/types/precious-metals';
import { GemIcon, PlusIcon, RefreshCwIcon } from '@lucide/vue';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import HoldingForm from './components/holding-form.vue';
import ValuationSummary from './components/valuation-summary.vue';
import { sumMetalWeights } from './utils/overview-totals';

const { t } = useI18n();
const router = useRouter();
const { addNotification } = useNotificationCenter();
const overview = useMetalsOverview();
const weights = computed(() => sumMetalWeights({ holdings: overview.data.value?.holdings ?? [] }));
const refreshMutation = useMetalMutation({ mutationFn: refreshMetalPrices });
const createOpen = ref(false);

const onCreated = (holding: MetalHoldingDetailDto) => {
  createOpen.value = false;
  router.push({ name: ROUTES_NAMES.preciousMetalDetail, params: { id: holding.id } });
};

const refreshPrices = async () => {
  if (refreshMutation.isPending.value) return;
  try {
    const result = await refreshMutation.mutateAsync(undefined);
    addNotification({
      text: t(
        !result.configured
          ? 'preciousMetals.provider.unconfigured'
          : result.refreshed
            ? 'preciousMetals.provider.refreshed'
            : 'preciousMetals.provider.cached',
      ),
      type: NotificationType.success,
    });
  } catch (error) {
    addNotification({ text: getErrorMessage(error, t('errors.preciousMetals.save')), type: NotificationType.error });
  }
};
</script>

<template>
  <div class="@container/metals mx-auto w-full max-w-7xl space-y-6 p-4 @md/metals:p-6">
    <header class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 class="text-3xl font-semibold">{{ $t('preciousMetals.title') }}</h1>
        <p class="text-muted-foreground mt-2 max-w-xl text-sm">{{ $t('preciousMetals.subtitle') }}</p>
      </div>
      <Button @click="createOpen = true"><PlusIcon class="size-4" />{{ $t('preciousMetals.addHolding') }}</Button>
    </header>
    <div
      v-if="overview.isPending.value"
      class="grid gap-4 @md/metals:grid-cols-2"
      :aria-label="$t('preciousMetals.loading')"
    >
      <div v-for="i in 4" :key="i" class="bg-muted h-64 animate-pulse rounded-xl" />
    </div>
    <div v-else-if="overview.isError.value" role="alert" class="grid justify-items-start gap-3">
      <p class="text-destructive-text">{{ $t('errors.preciousMetals.load') }}</p>
      <Button variant="outline" @click="overview.refetch()">{{ $t('common.actions.retry') }}</Button>
    </div>
    <template v-else-if="overview.data.value">
      <div class="bg-muted/40 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
        <p class="text-muted-foreground max-w-xl text-sm">
          {{
            overview.data.value.provider.configured
              ? $t('preciousMetals.provider.configured', {
                  provider: overview.data.value.provider.name,
                  hours: overview.data.value.provider.refreshHours,
                })
              : $t('preciousMetals.provider.manual')
          }}
        </p>
        <Button
          v-if="overview.data.value.provider.configured"
          variant="outline"
          :disabled="refreshMutation.isPending.value"
          :loading="refreshMutation.isPending.value"
          @click="refreshPrices"
          ><RefreshCwIcon class="size-4" />{{ $t('preciousMetals.provider.refresh') }}</Button
        >
      </div>
      <Card v-if="overview.data.value.holdings.length === 0"
        ><CardContent class="flex flex-col items-center gap-3 py-14 text-center"
          ><GemIcon class="text-muted-foreground size-10" />
          <h2 class="text-xl font-medium">{{ $t('preciousMetals.empty.title') }}</h2>
          <p class="text-muted-foreground max-w-lg text-sm">{{ $t('preciousMetals.empty.description') }}</p>
          <Button class="mt-2" @click="createOpen = true"
            ><PlusIcon class="size-4" />{{ $t('preciousMetals.empty.action') }}</Button
          ></CardContent
        ></Card
      >
      <div v-if="overview.data.value.holdings.length" class="grid gap-3 @md/metals:grid-cols-2 @3xl/metals:grid-cols-3">
        <Card v-for="weight in weights" :key="weight.metal"
          ><CardContent class="p-4">
            <h2 class="mb-3 font-semibold">{{ $t(`preciousMetals.metal.${weight.metal}`) }}</h2>
            <dl class="grid grid-cols-2 gap-4">
              <div>
                <dt class="text-muted-foreground text-xs">{{ $t('preciousMetals.valuation.fineGrams') }}</dt>
                <dd class="mt-1 text-lg font-medium tabular-nums">
                  <PrecisionNumber :value="weight.fineGrams" :max-decimals="6" />
                </dd>
              </div>
              <div>
                <dt class="text-muted-foreground text-xs">{{ $t('preciousMetals.valuation.fineOz') }}</dt>
                <dd class="mt-1 text-lg font-medium tabular-nums">
                  <PrecisionNumber :value="weight.fineTroyOunces" :max-decimals="6" />
                </dd>
              </div>
            </dl> </CardContent
        ></Card>
      </div>
      <div v-if="overview.data.value.holdings.length" class="grid gap-4 @md/metals:grid-cols-2 @3xl/metals:grid-cols-3">
        <Card
          v-for="holding in overview.data.value.holdings"
          :key="holding.id"
          class="transition-shadow hover:shadow-md"
        >
          <CardContent class="p-5">
            <router-link
              :to="{ name: ROUTES_NAMES.preciousMetalDetail, params: { id: holding.id } }"
              class="hover:text-primary-text mb-4 block focus-visible:underline"
            >
              <p class="text-muted-foreground text-xs">
                {{ $t(`preciousMetals.metal.${holding.metal}`) }} · {{ $t(`preciousMetals.form.${holding.form}`) }}
              </p>
              <h2 class="mt-1 text-lg font-semibold">{{ holding.name }}</h2>
            </router-link>
            <ValuationSummary :valuation="holding.valuation" compact />
          </CardContent>
        </Card>
      </div>
      <p class="text-muted-foreground text-xs">{{ $t('preciousMetals.notice.spot') }}</p>
    </template>
    <ResponsiveDialog v-model:open="createOpen" dialog-content-class="max-w-xl" :hide-drawer-footer="true">
      <template #title>{{ $t('preciousMetals.addHolding') }}</template>
      <template #description>{{ $t('preciousMetals.subtitle') }}</template>
      <HoldingForm v-if="createOpen" @saved="onCreated" @cancel="createOpen = false" />
    </ResponsiveDialog>
  </div>
</template>
