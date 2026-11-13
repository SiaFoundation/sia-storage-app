/**
 * The answer file Windows Setup reads from a second CD to install with no one
 * at the screen: it wipes the VM's disk, installs Windows 11 Pro, skips the
 * out-of-box screens and the Microsoft account, and creates two local
 * accounts. `siaadmin` is the administrator setup uses for the rest of the
 * golden image. `siatest` is the account apps run under, signed in
 * automatically at every boot so a desktop session exists.
 *
 * The first boot signs in as `siaadmin` once, to run the commands that need an
 * administrator before anything else can reach the VM (Parallels Tools), and
 * those commands switch automatic sign-in to `siatest` and restart. They are
 * one command line chained with `&`, because Windows starts every first logon
 * command at once whatever its `Order`, and a separate restart would cut the
 * Tools installer short.
 */

export type UnattendOptions = {
  adminPassword: string
  testPassword: string
  computerName: string
}

/**
 * Microsoft's generic install key for Windows 11 Pro, which picks the edition
 * from the multi-edition ISO and does not activate, so the image runs
 * unactivated until a retail key is entered.
 */
const PRO_INSTALL_KEY = 'VK7JG-NPHTM-C97JM-9MPGT-3V66T'

const escapeXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const component = (name: string, body: string) =>
  `<component name="${name}" processorArchitecture="arm64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS" xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">${body}</component>`

const password = (value: string) =>
  `<Password><Value>${escapeXml(value)}</Value><PlainText>true</PlainText></Password>`

const account = (name: string, pw: string, group: string) =>
  `<LocalAccount wcm:action="add"><Name>${name}</Name><Group>${group}</Group>${password(pw)}</LocalAccount>`

/**
 * Finds the Parallels Tools CD by the installer on it and runs it silently.
 * Its drive letter depends on the order Setup found the CDs in.
 */
const INSTALL_TOOLS = `Get-PSDrive -PSProvider FileSystem | ForEach-Object { $p = Join-Path $_.Root 'PTAgent.exe'; if (Test-Path $p) { Start-Process $p -ArgumentList '/install_silent' -Wait } }`

export function autounattend(opts: UnattendOptions): string {
  const firstLogon = [
    `powershell -NoProfile -ExecutionPolicy Bypass -Command "${INSTALL_TOOLS}"`,
    // Hands automatic sign-in to the test account for every boot after this one.
    `reg add "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon" /v DefaultUserName /t REG_SZ /d siatest /f`,
    // Escaped once, with the whole command below. Escaping it here as well
    // would store "&amp;" in the registry for a password holding "&".
    `reg add "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon" /v DefaultPassword /t REG_SZ /d "${opts.testPassword}" /f`,
    `reg add "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon" /v AutoAdminLogon /t REG_SZ /d 1 /f`,
    `reg delete "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon" /v AutoLogonCount /f`,
    `shutdown /r /t 5`,
  ]
  // cmd runs each step after the one before has exited, whether it failed or
  // not, as the `reg delete` of a value that is not there does.
  const firstLogonCommand = `cmd /c ${firstLogon.join(' & ')}`

  const windowsPE =
    component(
      'Microsoft-Windows-International-Core-WinPE',
      '<SetupUILanguage><UILanguage>en-US</UILanguage></SetupUILanguage><InputLocale>en-US</InputLocale><SystemLocale>en-US</SystemLocale><UILanguage>en-US</UILanguage><UserLocale>en-US</UserLocale>',
    ) +
    component(
      'Microsoft-Windows-Setup',
      `<DiskConfiguration><Disk wcm:action="add"><DiskID>0</DiskID><WillWipeDisk>true</WillWipeDisk><CreatePartitions>` +
        `<CreatePartition wcm:action="add"><Order>1</Order><Type>EFI</Type><Size>300</Size></CreatePartition>` +
        `<CreatePartition wcm:action="add"><Order>2</Order><Type>MSR</Type><Size>16</Size></CreatePartition>` +
        `<CreatePartition wcm:action="add"><Order>3</Order><Type>Primary</Type><Extend>true</Extend></CreatePartition>` +
        `</CreatePartitions><ModifyPartitions>` +
        `<ModifyPartition wcm:action="add"><Order>1</Order><PartitionID>1</PartitionID><Format>FAT32</Format><Label>System</Label></ModifyPartition>` +
        `<ModifyPartition wcm:action="add"><Order>2</Order><PartitionID>3</PartitionID><Format>NTFS</Format><Label>Windows</Label><Letter>C</Letter></ModifyPartition>` +
        `</ModifyPartitions></Disk></DiskConfiguration>` +
        `<ImageInstall><OSImage><InstallTo><DiskID>0</DiskID><PartitionID>3</PartitionID></InstallTo>` +
        `<InstallFrom><MetaData wcm:action="add"><Key>/IMAGE/NAME</Key><Value>Windows 11 Pro</Value></MetaData></InstallFrom>` +
        `</OSImage></ImageInstall>` +
        `<UserData><AcceptEula>true</AcceptEula><ProductKey><Key>${PRO_INSTALL_KEY}</Key><WillShowUI>OnError</WillShowUI></ProductKey></UserData>`,
    )

  const specialize =
    component(
      'Microsoft-Windows-Shell-Setup',
      `<ComputerName>${escapeXml(opts.computerName)}</ComputerName><TimeZone>Pacific Standard Time</TimeZone>`,
    ) +
    component(
      'Microsoft-Windows-Deployment',
      // Lets out-of-box setup finish without a network or a Microsoft account.
      `<RunSynchronous><RunSynchronousCommand wcm:action="add"><Order>1</Order><Path>reg add HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\OOBE /v BypassNRO /t REG_DWORD /d 1 /f</Path></RunSynchronousCommand>` +
        // Windows 11 encrypts the system drive on its own otherwise, which
        // slows every write in a VM and protects nothing in a test image.
        `<RunSynchronousCommand wcm:action="add"><Order>2</Order><Path>reg add HKLM\\SYSTEM\\CurrentControlSet\\Control\\BitLocker /v PreventDeviceEncryption /t REG_DWORD /d 1 /f</Path></RunSynchronousCommand></RunSynchronous>`,
    )

  const oobe =
    component(
      'Microsoft-Windows-International-Core',
      '<InputLocale>en-US</InputLocale><SystemLocale>en-US</SystemLocale><UILanguage>en-US</UILanguage><UserLocale>en-US</UserLocale>',
    ) +
    component(
      'Microsoft-Windows-Shell-Setup',
      `<OOBE><HideEULAPage>true</HideEULAPage><HideOEMRegistrationScreen>true</HideOEMRegistrationScreen><HideOnlineAccountScreens>true</HideOnlineAccountScreens><HideWirelessSetupInOOBE>true</HideWirelessSetupInOOBE><ProtectYourPC>3</ProtectYourPC><SkipMachineOOBE>true</SkipMachineOOBE><SkipUserOOBE>true</SkipUserOOBE></OOBE>` +
        `<UserAccounts><LocalAccounts>${account('siaadmin', opts.adminPassword, 'Administrators')}${account('siatest', opts.testPassword, 'Users')}</LocalAccounts></UserAccounts>` +
        `<AutoLogon><Enabled>true</Enabled><LogonCount>1</LogonCount><Username>siaadmin</Username>${password(opts.adminPassword)}</AutoLogon>` +
        `<FirstLogonCommands><SynchronousCommand wcm:action="add"><Order>1</Order><CommandLine>${escapeXml(firstLogonCommand)}</CommandLine></SynchronousCommand></FirstLogonCommands>`,
    )

  return `<?xml version="1.0" encoding="utf-8"?>
<unattend xmlns="urn:schemas-microsoft-com:unattend">
<settings pass="windowsPE">${windowsPE}</settings>
<settings pass="specialize">${specialize}</settings>
<settings pass="oobeSystem">${oobe}</settings>
</unattend>
`
}
