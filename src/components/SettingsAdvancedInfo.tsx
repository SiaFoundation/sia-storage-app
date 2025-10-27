import { Switch } from 'react-native'
import { setShowAdvanced, useShowAdvanced } from '../stores/settings'
import { RowGroup } from './Group'
import { InfoCard } from './InfoCard'
import { LabeledValueRow } from './LabeledValueRow'

export function SettingsAdvancedInfo() {
  const showAdvanced = useShowAdvanced()

  return (
    <RowGroup title="Developers">
      <InfoCard>
        <LabeledValueRow
          label="Show advanced information"
          labelWidth={200}
          value={
            <Switch
              value={showAdvanced.data}
              onValueChange={(val) => setShowAdvanced(val)}
            />
          }
        />
      </InfoCard>
    </RowGroup>
  )
}
