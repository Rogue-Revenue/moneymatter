<script setup lang="ts">
import { deleteMetalEvent, unlinkMetalEvent } from '@/api/precious-metals';
import { formatShortDate } from '@/common/utils/date';
import { useDateLocale } from '@/composable/use-date-locale';
import { getErrorMessage } from '@/common/utils/error-message';
import { formatFractionAsPercent } from '@/common/utils/percentage';
import PrecisionNumber from '@/components/common/precision-number.vue';
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import { Button } from '@/components/lib/ui/button';
import { Card, CardContent } from '@/components/lib/ui/card';
import { NotificationType, useNotificationCenter } from '@/components/notification-center';
import { useMetalHolding, useMetalMutation } from '@/composable/data-queries/precious-metals';
import { useFormatCurrency } from '@/composable/formatters';
import { cn } from '@/lib/utils';
import { ROUTES_NAMES } from '@/routes/constants';
import type { MetalEventDto, MetalEventType } from '@bt/shared/types/precious-metals';
import { ArrowLeftIcon, GemIcon, PencilIcon, PlusIcon } from '@lucide/vue';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';

import EventForm from './components/event-form.vue';
import HoldingForm from './components/holding-form.vue';
import LinkEventForm from './components/link-event-form.vue';
import QuoteForm from './components/quote-form.vue';
import ValuationSummary from './components/valuation-summary.vue';

const route = useRoute();
const id = computed(() => String(route.params.id ?? ''));
const query = useMetalHolding({ id });
const holding = query.data;
const { t } = useI18n();
const { addNotification } = useNotificationCenter();
const { formatAmountByCurrencyCode } = useFormatCurrency();
const { format: formatQuoteTime } = useDateLocale();
const editOpen = ref(false);
const quoteOpen = ref(false);
const eventType = ref<MetalEventType | null>(null);
const linkingEvent = ref<MetalEventDto | null>(null);
const confirmation = ref<{ event: MetalEventDto; action: 'remove' | 'unlink' } | null>(null);
const removeMutation = useMetalMutation({ mutationFn: deleteMetalEvent });
const unlinkMutation = useMetalMutation({ mutationFn: unlinkMetalEvent });
const actionPending = computed(() => removeMutation.isPending.value || unlinkMutation.isPending.value);
const events = computed(() =>
  [...(holding.value?.events ?? [])].sort(
    (a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt),
  ),
);
const quotes = computed(() =>
  [...(holding.value?.quotes ?? [])].sort(
    (a, b) => b.asOf.localeCompare(a.asOf) || b.retrievedAt.localeCompare(a.retrievedAt),
  ),
);

watch(id, () => {
  editOpen.value = false;
  quoteOpen.value = false;
  eventType.value = null;
  linkingEvent.value = null;
  confirmation.value = null;
});

const confirmAction = async () => {
  if (!confirmation.value || actionPending.value) return;
  const { event, action } = confirmation.value;
  try {
    const payload = { id: id.value, eventId: event.id };
    if (action === 'remove') await removeMutation.mutateAsync(payload);
    else await unlinkMutation.mutateAsync(payload);
    addNotification({
      text: t(action === 'remove' ? 'preciousMetals.notifications.removed' : 'preciousMetals.link.unlinked'),
      type: NotificationType.success,
    });
    confirmation.value = null;
  } catch (error) {
    addNotification({ text: getErrorMessage(error, t('errors.preciousMetals.save')), type: NotificationType.error });
  }
};
</script>

<template>
  <div class="@container/metal-detail mx-auto w-full max-w-6xl space-y-6 p-4">
    <router-link
      :to="{ name: ROUTES_NAMES.preciousMetals }"
      class="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      ><ArrowLeftIcon class="size-4" />{{ $t('preciousMetals.back') }}</router-link
    >
    <div v-if="query.isPending.value" class="grid gap-5" :aria-label="$t('preciousMetals.loading')">
      <div class="bg-muted h-20 animate-pulse rounded-xl" />
      <div class="bg-muted h-72 animate-pulse rounded-xl" />
      <div class="bg-muted h-40 animate-pulse rounded-xl" />
    </div>
    <div v-else-if="query.isError.value" role="alert" class="grid justify-items-start gap-3">
      <p class="text-destructive-text">{{ $t('errors.preciousMetals.load') }}</p>
      <Button variant="outline" @click="query.refetch()">{{ $t('common.actions.retry') }}</Button>
    </div>
    <template v-else-if="holding">
      <header class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p class="text-muted-foreground mb-2 flex items-center gap-2 text-sm">
            <GemIcon class="size-4" />{{ $t(`preciousMetals.metal.${holding.metal}`) }} ·
            {{ $t(`preciousMetals.form.${holding.form}`) }}
          </p>
          <h1 class="text-3xl font-semibold">{{ holding.name }}</h1>
        </div>
        <Button variant="outline" @click="editOpen = true"
          ><PencilIcon class="size-4" />{{ $t('preciousMetals.editHolding') }}</Button
        >
      </header>
      <div class="flex flex-wrap gap-2">
        <Button @click="eventType = 'purchase'"
          ><PlusIcon class="size-4" />{{ $t('preciousMetals.actions.purchase') }}</Button
        >
        <Button variant="secondary" :disabled="Number(holding.valuation.quantity) <= 0" @click="eventType = 'sale'">{{
          $t('preciousMetals.actions.sale')
        }}</Button>
        <Button variant="outline" @click="eventType = 'opening'">{{ $t('preciousMetals.actions.opening') }}</Button>
        <Button variant="outline" @click="quoteOpen = true">{{ $t('preciousMetals.actions.quote') }}</Button>
      </div>
      <Card
        ><CardContent class="p-5"
          ><ValuationSummary :valuation="holding.valuation" />
          <p class="text-muted-foreground mt-5 text-xs">{{ $t('preciousMetals.notice.spot') }}</p></CardContent
        ></Card
      >
      <Card
        ><CardContent class="grid gap-5 p-5 @md/metal-detail:grid-cols-2">
          <dl class="grid gap-3 text-sm">
            <div class="flex flex-wrap justify-between gap-2">
              <dt class="text-muted-foreground">{{ $t('preciousMetals.fields.weight') }}</dt>
              <dd>
                <PrecisionNumber :value="holding.weightPerItem" :max-decimals="6" />
                {{ $t(`preciousMetals.unit.${holding.weightUnit}`) }}
              </dd>
            </div>
            <div class="flex flex-wrap justify-between gap-2">
              <dt class="text-muted-foreground">{{ $t('preciousMetals.fields.basis') }}</dt>
              <dd>{{ $t(`preciousMetals.basis.${holding.weightBasis}`) }}</dd>
            </div>
            <div class="flex flex-wrap justify-between gap-2">
              <dt class="text-muted-foreground">{{ $t('preciousMetals.fields.purity') }}</dt>
              <dd>{{ formatFractionAsPercent(holding.purity, { maximumFractionDigits: 6 }) }}</dd>
            </div>
            <div class="flex flex-wrap justify-between gap-2">
              <dt class="text-muted-foreground">{{ $t('preciousMetals.fields.pricing') }}</dt>
              <dd>{{ $t(`preciousMetals.mode.${holding.pricingMode}`) }}</dd>
            </div>
          </dl>
          <div v-if="holding.storageNotes">
            <h2 class="text-muted-foreground text-xs">{{ $t('preciousMetals.fields.storage') }}</h2>
            <p class="mt-2 text-sm whitespace-pre-wrap">{{ holding.storageNotes }}</p>
          </div>
        </CardContent></Card
      >
      <section class="space-y-3">
        <h2 class="text-xl font-semibold">{{ $t('preciousMetals.lots.title') }}</h2>
        <p class="text-muted-foreground text-xs">{{ $t('preciousMetals.notice.fifo') }}</p>
        <p v-if="holding.lots.length === 0" class="text-muted-foreground rounded-xl border p-5 text-sm">
          {{ $t('preciousMetals.lots.empty') }}
        </p>
        <div v-else class="grid gap-3 @md/metal-detail:grid-cols-2">
          <Card v-for="lot in holding.lots" :key="lot.eventId"
            ><CardContent class="space-y-2 p-4 text-sm">
              <p class="font-medium">{{ formatShortDate(lot.date) }}</p>
              <p>
                {{ $t('preciousMetals.lots.remaining', { remaining: lot.remainingQuantity, quantity: lot.quantity }) }}
              </p>
              <p class="text-muted-foreground">
                {{ $t('preciousMetals.lots.fineWeight') }}:
                <PrecisionNumber :value="lot.fineGramsPerItem" :max-decimals="6" />
              </p>
              <p>
                {{ $t('preciousMetals.lots.cost') }}:
                {{
                  lot.remainingCost === null
                    ? $t('common.labels.unknown')
                    : formatAmountByCurrencyCode(lot.remainingCost, holding.currencyCode)
                }}
              </p>
            </CardContent></Card
          >
        </div>
      </section>
      <section class="space-y-3">
        <h2 class="text-xl font-semibold">{{ $t('preciousMetals.events.title') }}</h2>
        <p class="text-muted-foreground text-xs">{{ $t('preciousMetals.notice.cash') }}</p>
        <p v-if="events.length === 0" class="text-muted-foreground rounded-xl border p-5 text-sm">
          {{ $t('preciousMetals.events.empty') }}
        </p>
        <Card v-for="event in events" :key="event.id"
          ><CardContent class="space-y-3 p-4">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 class="font-medium">{{ $t(`preciousMetals.events.${event.type}`) }}</h3>
                <p class="text-muted-foreground mt-1 text-xs">{{ formatShortDate(event.date) }}</p>
              </div>
              <div class="text-right">
                <p class="tabular-nums">
                  <PrecisionNumber :value="event.quantity" :max-decimals="6" /> ·
                  {{
                    event.totalAmount === null
                      ? $t('common.labels.unknown')
                      : formatAmountByCurrencyCode(event.totalAmount, event.currencyCode)
                  }}
                </p>
                <p v-if="event.type !== 'opening'" class="text-muted-foreground mt-1 text-xs">
                  {{ $t(event.transactionId ? 'preciousMetals.events.linked' : 'preciousMetals.events.notLinked') }}
                </p>
              </div>
            </div>
            <div v-if="event.type === 'sale'" class="flex flex-wrap gap-x-5 gap-y-1 text-sm">
              <p>
                {{ $t('preciousMetals.events.costBasis') }}:
                {{
                  event.costBasis === null
                    ? $t('common.labels.unknown')
                    : formatAmountByCurrencyCode(event.costBasis, event.currencyCode)
                }}
              </p>
              <p
                :class="
                  cn(
                    event.realizedGain !== null &&
                      (event.realizedGain >= 0 ? 'text-app-income-color' : 'text-app-expense-color'),
                  )
                "
              >
                {{ $t('preciousMetals.events.realized') }}:
                {{
                  event.realizedGain === null
                    ? $t('common.labels.unknown')
                    : formatAmountByCurrencyCode(event.realizedGain, event.currencyCode)
                }}
              </p>
            </div>
            <p v-if="event.notes" class="text-muted-foreground text-sm whitespace-pre-wrap">{{ event.notes }}</p>
            <div class="flex flex-wrap gap-2">
              <Button
                v-if="event.type !== 'opening' && !event.transactionId"
                variant="outline"
                size="sm"
                :disabled="event.totalAmount === null || actionPending"
                @click="linkingEvent = event"
                >{{ $t('preciousMetals.actions.link') }}</Button
              >
              <Button
                v-if="event.transactionId"
                variant="outline"
                size="sm"
                :disabled="actionPending"
                @click="confirmation = { event, action: 'unlink' }"
                >{{ $t('preciousMetals.actions.unlink') }}</Button
              >
              <Button
                variant="ghost-destructive"
                size="sm"
                :disabled="actionPending"
                @click="confirmation = { event, action: 'remove' }"
                >{{ $t('preciousMetals.actions.remove') }}</Button
              >
            </div>
          </CardContent></Card
        >
      </section>
      <section class="space-y-3">
        <h2 class="text-xl font-semibold">{{ $t('preciousMetals.quotes.title') }}</h2>
        <p v-if="quotes.length === 0" class="text-muted-foreground rounded-xl border p-5 text-sm">
          {{ $t('preciousMetals.quotes.empty') }}
        </p>
        <div v-else class="divide-border divide-y rounded-xl border">
          <div v-for="quote in quotes" :key="quote.id" class="flex flex-wrap justify-between gap-3 p-4 text-sm">
            <div>
              <p class="font-medium">{{ formatAmountByCurrencyCode(quote.pricePerTroyOz, quote.currencyCode) }}</p>
              <p class="text-muted-foreground mt-1 text-xs">{{ $t('preciousMetals.valuation.price') }}</p>
            </div>
            <div class="text-muted-foreground text-xs">
              <p>
                {{
                  $t('preciousMetals.valuation.source', {
                    source: quote.isManual ? $t('preciousMetals.quotes.manual') : quote.source,
                  })
                }}
              </p>
              <p class="mt-1">
                {{
                  $t('preciousMetals.valuation.asOf', { date: formatQuoteTime(quote.asOf, 'd MMM yyyy, HH:mm:ss xxx') })
                }}
              </p>
              <p class="mt-1">
                {{
                  $t('preciousMetals.quotes.recorded', {
                    date: formatQuoteTime(quote.retrievedAt, 'd MMM yyyy, HH:mm:ss xxx'),
                  })
                }}
              </p>
            </div>
          </div>
        </div>
      </section>
    </template>
    <ResponsiveDialog v-model:open="editOpen" dialog-content-class="max-w-xl" :hide-drawer-footer="true"
      ><template #title>{{ $t('preciousMetals.editHolding') }}</template
      ><HoldingForm v-if="holding && editOpen" :holding="holding" @saved="editOpen = false" @cancel="editOpen = false"
    /></ResponsiveDialog>
    <ResponsiveDialog
      :open="eventType !== null"
      dialog-content-class="max-w-xl"
      :hide-drawer-footer="true"
      @update:open="
        (open) => {
          if (!open) eventType = null;
        }
      "
      ><template #title>{{ eventType ? $t(`preciousMetals.actions.${eventType}`) : '' }}</template
      ><EventForm
        v-if="holding && eventType"
        :holding="holding"
        :type="eventType"
        @saved="eventType = null"
        @cancel="eventType = null"
    /></ResponsiveDialog>
    <ResponsiveDialog v-model:open="quoteOpen" dialog-content-class="max-w-lg" :hide-drawer-footer="true"
      ><template #title>{{ $t('preciousMetals.actions.quote') }}</template
      ><QuoteForm v-if="holding && quoteOpen" :holding="holding" @saved="quoteOpen = false" @cancel="quoteOpen = false"
    /></ResponsiveDialog>
    <ResponsiveDialog
      :open="linkingEvent !== null"
      dialog-content-class="max-w-lg"
      :hide-drawer-footer="true"
      @update:open="
        (open) => {
          if (!open) linkingEvent = null;
        }
      "
      ><template #title>{{ $t('preciousMetals.link.title') }}</template
      ><LinkEventForm
        v-if="holding && linkingEvent"
        :holding-id="holding.id"
        :event="linkingEvent"
        @saved="linkingEvent = null"
        @cancel="linkingEvent = null"
    /></ResponsiveDialog>
    <ResponsiveAlertDialog
      :open="confirmation !== null"
      :confirm-label="
        $t(confirmation?.action === 'remove' ? 'dialogs.preciousMetals.removeConfirm' : 'preciousMetals.actions.unlink')
      "
      confirm-variant="destructive"
      :confirm-disabled="actionPending"
      @update:open="
        (open) => {
          if (!open) confirmation = null;
        }
      "
      @confirm="confirmAction"
      ><template #title>{{
        $t(
          confirmation?.action === 'remove'
            ? 'dialogs.preciousMetals.removeTitle'
            : 'dialogs.preciousMetals.unlinkTitle',
        )
      }}</template
      ><template #description>{{
        $t(
          confirmation?.action === 'remove'
            ? 'dialogs.preciousMetals.removeDescription'
            : 'dialogs.preciousMetals.unlinkDescription',
        )
      }}</template></ResponsiveAlertDialog
    >
  </div>
</template>
