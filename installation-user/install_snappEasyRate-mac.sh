#!/bin/bash

# مسیر فایل plist کاربر
PLIST="$HOME/Library/Preferences/com.google.Chrome.plist"

# مطمئن شدن که plist موجوده یا ایجادش کنیم
if [ ! -f "$PLIST" ]; then
    /usr/libexec/PlistBuddy -c "Save" "$PLIST"
fi

# افزودن افزونه به ExtensionInstallForcelist
/usr/libexec/PlistBuddy -c "Add :ExtensionInstallForcelist array" "$PLIST" 2>/dev/null
/usr/libexec/PlistBuddy -c "Add :ExtensionInstallForcelist:0 string biahgfbknnilkhpkkadbkmheehhkomci;https://a4france.com/snappyar/updates.xml" "$PLIST" 2>/dev/null

echo "افزونه SnappEasyRate با موفقیت برای کاربر فعلی نصب شد."
echo "لطفاً Chrome را ببندید و دوباره باز کنید."