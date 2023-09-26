import { FunctionReference } from 'convex/server';
import { Doc, TableNames } from '../../convex/_generated/dataModel';
import { useQuery } from 'convex/react';

export function useContinuousQuery<Name extends TableNames>(
  reference: FunctionReference<'query', 'public', any, Doc<Name>>,
  args: any,
): Doc<Name> | undefined {
  const result = useQuery(reference, args);
  if (result === undefined) {
    return undefined;
  }
  return result;
}
