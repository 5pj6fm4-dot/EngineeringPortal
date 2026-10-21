// ============================================================
// 檔案：modules/unit_converter.js
// 共用工程單位轉換工具：所有模組統一使用此檔案中的係數。
// ============================================================
(function (global) {
  'use strict';

  const UNIT_DATA = {
    '長度': { base: 'm', units: {
      'm':1,'km':1000,'dm':0.1,'cm':0.01,'mm':0.001,'µm':1e-6,'nm':1e-9,
      'in':0.0254,'ft':0.3048,'yd':0.9144,'mile':1609.344,'n mile':1852
    }},
    '面積': { base:'m²', units:{'m²':1,'km²':1e6,'cm²':1e-4,'mm²':1e-6,'µm²':1e-12,'in²':0.00064516,'ft²':0.09290304,'yd²':0.83612736,'ha':10000,'acre':4046.8564224}},
    '體積': { base:'m³', units:{'m³':1,'cm³':1e-6,'mm³':1e-9,'L':0.001,'mL':1e-6,'µL':1e-9,'in³':1.6387064e-5,'ft³':0.028316846592,'gal(US)':0.003785411784,'gal(UK)':0.00454609}},
    '質量': { base:'kg', units:{'kg':1,'g':0.001,'mg':1e-6,'µg':1e-9,'t':1000,'Mg':1000,'公斤':1,'台斤':0.6,'市斤':0.5,'lb':0.45359237,'oz':0.028349523125}},
    '密度': { base:'kg/m³', units:{'kg/m³':1,'kg/dm³':1000,'kg/L':1000,'kg/cm³':1e6,'kg/mm³':1e9,'g/m³':0.001,'g/cm³':1000,'g/mm³':1e6,'g/L':1,'mg/mL':1,'lb/ft³':16.01846337396,'lb/in³':27679.9047102}},
    '力': { base:'N', units:{'N':1,'kN':1000,'MN':1e6,'kgf':9.80665,'gf':0.00980665,'lbf':4.4482216152605,'ozf':0.2780138509538}},
    '力矩／扭矩': { base:'N·m', units:{'N·m':1,'kN·m':1000,'N·cm':0.01,'N·mm':0.001,'kgf·m':9.80665,'kgf·cm':0.0980665,'gf·cm':0.0000980665,'ozf·in':0.00706155183333,'ozf·ft':0.084738622,'lbf·in':0.1129848290276,'lbf·ft':1.3558179483314}},
    '壓力／應力': { base:'Pa', units:{'Pa':1,'kPa':1000,'MPa':1e6,'GPa':1e9,'bar':1e5,'mbar':100,'psi':6894.757293168,'atm':101325,'mmHg':133.322387415,'kgf/cm²':98066.5,'kgf/mm²':9806650,'N/m²':1,'N/cm²':1e4,'N/mm²':1e6}},
    '速度': { base:'m/s', units:{'m/s':1,'m/min':1/60,'m/h':1/3600,'km/h':1/3.6,'ft/s':0.3048,'ft/min':0.00508,'in/s':0.0254,'in/min':0.0254/60,'yd/s':0.9144,'mile/h':1609.344/3600,'mph':1609.344/3600,'knot':1852/3600,'n mile/h':1852/3600}},
    '轉速／角速度': { base:'rad/s', units:{'rad/s':1,'rpm':2*Math.PI/60,'r/min':2*Math.PI/60,'r/s':2*Math.PI,'°/s':Math.PI/180,'°/min':Math.PI/10800}},
    '溫度': { base:'K', units:{'°C':'temperature','°F':'temperature','K':'temperature'}},
    '時間': { base:'s', units:{'s':1,'ms':0.001,'µs':1e-6,'ns':1e-9,'min':60,'h':3600,'day':86400,'week':604800}},
    '功率': { base:'W', units:{'W':1,'kW':1000,'MW':1e6,'hp':745.699871582,'Btu/s':1055.05585262,'kcal/s':4184}},
    '能量': { base:'J', units:{'J':1,'kJ':1000,'MJ':1e6,'cal':4.184,'kcal':4184,'Btu':1055.05585262,'Wh':3600,'kWh':3600000}},
    '表面張力': { base:'N/m', units:{'N/m':1,'mN/m':0.001,'mN/mm':1,'dyn/cm':0.001,'dyn/m':0.00001,'gf/cm':0.980665,'gf/m':0.00980665,'kgf/m':9.80665,'kgf/cm':980.665,'lbf/ft':14.5939029372}},
    '體積流量': { base:'m³/s', units:{'m³/s':1,'m³/min':1/60,'m³/h':1/3600,'L/s':0.001,'L/min':0.001/60,'L/h':0.001/3600,'ft³/s':0.028316846592,'ft³/min':0.028316846592/60,'gal(US)/min':0.003785411784/60,'gal(UK)/min':0.00454609/60,'bbl/d':0.158987294928/86400}},
    '動力黏度': { base:'Pa·s', units:{'Pa·s':1,'mPa·s':0.001,'cP':0.001,'P':0.1,'kg/(m·s)':1,'lb/(ft·s)':1.48816394357}},
    '運動黏度': { base:'m²/s', units:{'m²/s':1,'mm²/s':1e-6,'cm²/s':1e-4,'cSt':1e-6,'St':1e-4}}
  };

  function categoryData(category) {
    if (!UNIT_DATA[category]) throw new Error(`不支援的單位類別：${category}`);
    return UNIT_DATA[category];
  }
  function temperatureToK(v,u) {
    if(u==='°C') return v+273.15;
    if(u==='°F') return (v-32)*5/9+273.15;
    if(u==='K') return v;
    throw new Error(`不支援的溫度單位：${u}`);
  }
  function temperatureFromK(v,u) {
    if(u==='°C') return v-273.15;
    if(u==='°F') return (v-273.15)*9/5+32;
    if(u==='K') return v;
    throw new Error(`不支援的溫度單位：${u}`);
  }
  function convert(value,fromUnit,toUnit,category) {
    const v=Number(value);
    if(!Number.isFinite(v)) throw new TypeError('輸入數值必須是有效數字');
    const d=categoryData(category);
    if(!Object.prototype.hasOwnProperty.call(d.units,fromUnit)) throw new Error(`類別「${category}」不支援來源單位：${fromUnit}`);
    if(!Object.prototype.hasOwnProperty.call(d.units,toUnit)) throw new Error(`類別「${category}」不支援目標單位：${toUnit}`);
    if(category==='溫度') return temperatureFromK(temperatureToK(v,fromUnit),toUnit);
    return v*d.units[fromUnit]/d.units[toUnit];
  }
  function toBase(value,unit,category) {
    const v=Number(value),d=categoryData(category);
    if(!Number.isFinite(v)) throw new TypeError('輸入數值必須是有效數字');
    if(!Object.prototype.hasOwnProperty.call(d.units,unit)) throw new Error(`不支援的單位：${unit}`);
    return category==='溫度'?temperatureToK(v,unit):v*d.units[unit];
  }
  function fromBase(value,unit,category) {
    const v=Number(value),d=categoryData(category);
    if(!Number.isFinite(v)) throw new TypeError('基準數值必須是有效數字');
    if(!Object.prototype.hasOwnProperty.call(d.units,unit)) throw new Error(`不支援的單位：${unit}`);
    return category==='溫度'?temperatureFromK(v,unit):v/d.units[unit];
  }
  function getUnits(category){return Object.keys(categoryData(category).units);}
  function getCategories(){return Object.keys(UNIT_DATA);}
  function getBaseUnit(category){return categoryData(category).base;}
  function format(value,significantDigits=10) {
    if(!Number.isFinite(value)) return '—';
    if(value===0) return '0';
    const abs=Math.abs(value);
    if(abs>=1e12||abs<1e-7) return value.toExponential(6);
    return Number(value.toPrecision(significantDigits)).toLocaleString('en-US',{useGrouping:false,maximumSignificantDigits:significantDigits});
  }
  global.UnitConverter=Object.freeze({convert,toBase,fromBase,getUnits,getCategories,getBaseUnit,format,data:UNIT_DATA});
})(window);
