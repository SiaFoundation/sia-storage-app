import { View, StyleSheet } from 'react-native'
import { Hosts } from '../components/Hosts'
import { type NativeStackScreenProps } from '@react-navigation/native-stack'
import { type SettingsStackParamList } from './SettingsHomeScreen'

type Props = NativeStackScreenProps<SettingsStackParamList, 'Hosts'>

export default function HostsScreen({ navigation }: Props) {
  return (
    <View style={styles.flex1}>
      <Hosts
        hideHeader
        onSelectHost={(host) => navigation.navigate('HostDetail', { host })}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
})
