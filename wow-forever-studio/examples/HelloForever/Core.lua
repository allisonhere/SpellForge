-- HelloForever: example addon (user-maintained code).
local addonName, ns = ...

local frame = CreateFrame("Frame")
frame:RegisterEvent("PLAYER_LOGIN")
frame:RegisterEvent("PLAYER_REGEN_DISABLED")

local function Say(msg)
    print("|cff7c5cffHelloForever|r " .. msg)
end

frame:SetScript("OnEvent", function(_, event)
    if event == "PLAYER_LOGIN" then
        HelloForeverDB = HelloForeverDB or { greeted = 0 }
        HelloForeverDB.greeted = HelloForeverDB.greeted + 1
        -- C_Spell.GetSpellInfo replaces the Classic-era GetSpellInfo on Forever.
        local info = C_Spell.GetSpellInfo(133)
        Say(info and info.name or "ready")
    elseif event == "PLAYER_REGEN_DISABLED" then
        Say("entering combat")
    end
end)
