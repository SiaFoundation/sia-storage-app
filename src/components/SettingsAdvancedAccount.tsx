import { RowGroup } from './Group'
import { InfoCard } from './InfoCard'
import { LabeledValueRow } from './LabeledValueRow'
import { useAccount } from '../hooks/useAccount'

export function SettingsAdvancedAccount() {
  const account = useAccount()

  return account.data ? (
    <RowGroup title="Account">
      <InfoCard>
        <LabeledValueRow label="Account Key" value={account.data.accountKey} />
      </InfoCard>
    </RowGroup>
  ) : null
}
