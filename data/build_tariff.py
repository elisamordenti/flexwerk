"""Write the German C&I tariff (2026) as a declared, sourced JSON.

Every number carries: value, unit, source, url, how deeply the source was read, confidence.
Prices are NET of VAT (VAT is recoverable for businesses).
"""
from common import write_json

NL = {
    "source": "Netz Leipzig GmbH, Preisblatt Netznutzungsentgelte Strom 2026 (final), gueltig ab 01.01.2026, p. 2-3",
    "url": "https://files.l.de/lde-typo3/Netz/Downloads/Netznutzung/Strom/Netz_Leipzig_Preisblatt_NNE_Strom_2026_final.pdf",
    "read": "full text of pages 1-3 extracted and read",
    "confidence": "high",
}
LEVY_SRC = {
    "source": "Uebertragungsnetzbetreiber, Umlagen 2026 (netztransparenz.de), as reproduced on DSO levy sheets (e.g. Thueringer Energienetze 'Umlagen Strom' 2026)",
    "url": "https://www.netztransparenz.de/",
    "read": "values cross-checked on 3 independent DSO/supplier sheets; primary page not read in full",
    "confidence": "high",
}


def level(lt_ap, lt_lp, ge_ap, ge_lp):
    return {
        "below2500h": {"energyCtPerKWh": lt_ap, "peakEurPerKWYear": lt_lp},
        "atOrAbove2500h": {"energyCtPerKWh": ge_ap, "peakEurPerKWYear": ge_lp},
    }


def main():
    doc = {
        "id": "de_netzleipzig_2026",
        "label": "Germany, Netz Leipzig 2026 (one example DSO)",
        "currency": "EUR",
        "vat": "excluded (recoverable for businesses)",
        "gridFee": {
            "system": "Jahresleistungspreissystem (annual peak price), section 17 (2) StromNEV",
            "peakDefinition": "highest 15-min average import power in the billing year (kW)",
            "utilisationHoursRule": (
                "Full-load hours h = annual import kWh / annual peak kW. If h < 2500 the 'below2500h' pair "
                "applies, otherwise 'atOrAbove2500h'. The two pairs meet at 2500 h, so the bill equals the "
                "cheaper of the two (a concave function of the peak)."
            ),
            "thresholdHours": 2500,
            "levels": {
                "HS/MS": level(4.48, 8.40, 0.76, 101.41),
                "MS": level(5.19, 12.16, 1.62, 101.62),
                "MS/NS": level(5.42, 13.12, 1.82, 103.16),
                "NS": level(5.96, 19.17, 3.44, 82.02),
            },
            "defaultLevel": "MS",
            "monthlyOption": {
                "note": "Monatsleistungspreis option, not modelled in v1",
                "MS": {"energyCtPerKWh": 1.62, "peakEurPerKWMonth": 16.94},
                "NS": {"energyCtPerKWh": 3.44, "peakEurPerKWMonth": 13.67},
            },
            "lossCorrectionFactor": {"value": 0.0247, "note": "applied by DSO only when metering is not at the connection level; ignored"},
            **NL,
        },
        "levies": {
            "kwkg": {"ctPerKWh": 0.446, "label": "KWKG-Umlage 2026", **LEVY_SRC},
            "offshore": {"ctPerKWh": 0.941, "label": "Offshore-Netzumlage 2026", **LEVY_SRC},
            "specialGridUse": {
                "label": "Aufschlag fuer besondere Netznutzung 2026 (formerly section 19 StromNEV levy)",
                "firstGWhCtPerKWh": 1.559,
                "aboveGWhCtPerKWh": 0.050,
                "aboveGWhManufacturingCtPerKWh": 0.025,
                "note": "first 1,000,000 kWh per offtake point per year at the full rate (group A')",
                **LEVY_SRC,
            },
            "concession": {
                "ctPerKWh": 0.11,
                "label": "Konzessionsabgabe, Sondervertragskunden (section 2 (3) no. 1 KAV)",
                "note": "maximum rate for special-contract customers; exemption possible below the Grenzpreis (section 2 (4) KAV), not modelled. Low-voltage supply can count as Tarifkunde (section 2 (7) KAV) with higher rates.",
                "source": "Konzessionsabgabenverordnung, section 2", "url": "https://www.gesetze-im-internet.de/kav/__2.html",
                "read": "statute paragraph read via secondary reproductions", "confidence": "high",
            },
            "electricityTax": {
                "standardCtPerKWh": 2.05,
                "manufacturingCtPerKWh": 0.05,
                "label": "Stromsteuer (section 3 StromStG); reduced to the EU minimum for manufacturing via relief (section 9b StromStG) from 2026",
                "note": "the reduced rate is granted on application to the customs office, not automatically",
                "source": "StromStG; IHK and supplier summaries of the 2026 change",
                "url": "https://www.gesetze-im-internet.de/stromstg/",
                "read": "secondary summaries (IHK Lippe-Detmold, Vattenfall); statute not read in full",
                "confidence": "medium",
            },
        },
        "supplierMargin": {"ctPerKWh": 1.0, "source": "example choice", "confidence": "none: no public source"},
        "export": {
            "rule": "PV export earns the day-ahead price; zero when the price is negative",
            "basis": "Direct marketing at market value; section 51 EEG (Solarspitzengesetz, plants commissioned from 25.02.2025): no payment in negative-price periods. Market premium (Marktpraemie) NOT modelled.",
            "source": "EEG 2023 as amended 25.02.2025 (section 51); secondary summaries",
            "url": "https://www.gesetze-im-internet.de/eeg_2014/__51.html",
            "read": "secondary summaries; statute not read in full",
            "confidence": "medium (simplified)",
            "batteryExport": "not allowed in v1 (behind-the-meter only; avoids mixed-use metering rules)",
        },
        "outlook": {
            "agnes": "BNetzA draft determination AgNes (GBK-25-01-1#3, 6 Aug 2026): for consumers > 100 MWh/yr the annual peak price would be replaced by a booked-capacity price from 2029. Not modelled.",
            "url": "https://www.bundesnetzagentur.de/SharedDocs/Pressemitteilungen/20260527_AgnesPapier.pdf",
        },
    }
    write_json("tariff_de_netzleipzig_2026", doc)


if __name__ == "__main__":
    main()
