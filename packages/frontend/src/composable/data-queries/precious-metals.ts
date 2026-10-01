import { getMetalHolding, getMetalsOverview } from '@/api/precious-metals';
import { VUE_QUERY_CACHE_KEYS, VUE_QUERY_GLOBAL_PREFIXES } from '@/common/const';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { type MaybeRefOrGetter, toValue } from 'vue';

export const useMetalsOverview = () =>
  useQuery({
    queryKey: VUE_QUERY_CACHE_KEYS.preciousMetalsOverview,
    queryFn: getMetalsOverview,
  });

export const useMetalHolding = ({ id }: { id: MaybeRefOrGetter<string> }) =>
  useQuery({
    queryKey: [...VUE_QUERY_CACHE_KEYS.preciousMetalHolding, id],
    queryFn: () => getMetalHolding({ id: toValue(id) }),
    enabled: () => !!toValue(id),
  });

export const useMetalMutation = <TData, TVariables>({
  mutationFn,
}: {
  mutationFn: (variables: TVariables) => Promise<TData>;
}) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () =>
      queryClient.invalidateQueries({
        predicate: (query) =>
          query.queryKey.includes(VUE_QUERY_GLOBAL_PREFIXES.preciousMetalsChange) ||
          query.queryKey.includes(VUE_QUERY_GLOBAL_PREFIXES.transactionChange),
      }),
  });
};
