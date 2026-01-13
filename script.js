const width = 960;
const height = 600;

const svg = d3.select("#map-container")
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("preserveAspectRatio", "xMidYMid meet");

const projection = d3.geoMercator()
    .scale(150)
    .translate([width / 2, height / 2]);

const path = d3.geoPath()
    .projection(projection);

fetch("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json")
    .then(response => response.json())
    .then(world => {
        const countries = topojson.feature(world, world.objects.countries).features;
        const countryNames = world.objects.countries.geometries.map(d => d.properties.name);

        svg.selectAll(".country")
            .data(countries)
            .enter()
            .append("path")
            .attr("class", "country")
            .attr("d", path)
            .attr("data-name", (d, i) => countryNames[i] || "Unknown")
            .on("mouseover", function(event, d) {
                const countryName = d3.select(this).attr("data-name");
                document.getElementById("country-name").textContent = countryName;
                console.log("Hovered country:", countryName);
            })
            .on("mouseout", function(event, d) {
                document.getElementById("country-name").textContent = "";
            })
            .on("click", function(event, d) {
                const countryName = d3.select(this).attr("data-name");
                showCountryInfo(countryName);
            });
    })
    .catch(error => console.error("Kunne ikke laste kartdata:", error));

async function showCountryInfo(countryName) {
    const modal = document.getElementById('countryModal');
    const modalBody = document.getElementById('modalBody');
    
    modal.classList.add('active');
    modalBody.innerHTML = '<div class="loading">Laster informasjon...</div>';
    
    try {
        const res = await fetch(`https://restcountries.com/v3.1/name/${encodeURIComponent(countryName)}?fullText=true`);
        if (!res.ok) throw new Error('Land ikke funnet');
        const data = await res.json();
        if (!data || data.length === 0) {
            modalBody.innerHTML = '<div class="loading">Informasjon om landet er ikke tilgjengelig.</div>';
            return;
        }

        const country = data[0];
        const extras = await fetchAdditionalCountryData(country);
        displayCountryInfo(country, extras);
    } catch (error) {
        console.error('Kunne ikke hente landdata:', error);
        modalBody.innerHTML = `<div class="loading">Kunne ikke laste informasjon for ${countryName}.</div>`;
    }
}

async function fetchAdditionalCountryData(country) {
    const cca2 = country.cca2 ? country.cca2.toLowerCase() : '';
    const firstTimezone = country.timezones && country.timezones.length ? country.timezones[0] : 'N/A';
    const capitalName = country.capital && country.capital.length ? country.capital[0] : null;
    // const latlng = country.latlng || [];

    const gdpTotalPromise = fetchWorldBankIndicator(cca2, 'NY.GDP.MKTP.CD');
    const gdpPerCapPromise = fetchWorldBankIndicator(cca2, 'NY.GDP.PCAP.CD');
    const giniPromise = fetchWorldBankIndicator(cca2, 'SI.POV.GINI');
    const timeInfo = computeLocalTime(firstTimezone, capitalName);

    const [gdpTotal, gdpPerCapita, gini] = await Promise.all([gdpTotalPromise, gdpPerCapPromise, giniPromise]);

    const area = country.area ? `${country.area.toLocaleString()} km²` : 'N/A';
    const callingCode = country.idd && country.idd.root
        ? `${country.idd.root}${(country.idd.suffixes || [''])[0]}`
        : 'N/A';
    const tld = country.tld ? country.tld.join(', ') : 'N/A';
    const demonym = country.demonyms && country.demonyms.eng
        ? country.demonyms.eng.m || country.demonyms.eng.f
        : 'N/A';
    const currencies = country.currencies
        ? Object.values(country.currencies).map(curr => `${curr.name} (${curr.symbol})`).join(', ')
        : 'N/A';

    return {
        area,
        callingCode,
        tld,
        demonym,
        currencies,
        gdpTotal,
        gdpPerCapita,
        gini,
        timeInfo,
        timezone: firstTimezone
    };
}

function fetchWithTimeout(url, ms = 4000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), ms);
    return fetch(url, { signal: controller.signal })
        .finally(() => clearTimeout(id));
}

async function fetchWorldBankIndicator(cca2, indicator) {
    if (!cca2) return 'N/A';
    try {
        const res = await fetchWithTimeout(`https://api.worldbank.org/v2/country/${cca2}/indicator/${indicator}?format=json&per_page=1&date=2022`);
        const data = await res.json();
        const value = data && data[1] && data[1][0] && data[1][0].value;
        if (value === null || value === undefined) return 'N/A';
        
        const usdToNok = 10;
        const valueInNok = value * usdToNok;
        
        const formatted = indicator === 'NY.GDP.PCAP.CD'
            ? `${Number(valueInNok).toLocaleString('nb-NO', { maximumFractionDigits: 0 })} kr`
            : indicator === 'NY.GDP.MKTP.CD'
                ? `${Number(valueInNok).toLocaleString('nb-NO', { maximumFractionDigits: 0 })} kr`
                : Number(value).toLocaleString();
        return formatted;
    } catch (err) {
        console.error('World Bank API error', indicator, err);
        return 'N/A';
    }
}

function computeLocalTime(timezone, capitalName) {
    if (!timezone || timezone === 'N/A') {
        return { time: 'N/A', zone: 'N/A', label: capitalName || 'N/A' };
    }
    const label = capitalName || timezone;

    try {
        const now = new Date();
        const timeString = now.toLocaleString(undefined, { timeZone: timezone });
        if (timeString && timeString !== 'Invalid Date') {
            return { time: timeString, zone: timezone, label };
        }
    } catch (err) {
        console.warn('IANA timezone failed, trying UTC offset fallback', timezone);
    }

    const match = /^UTC([+-])(\d{1,2})(?::?(\d{2}))?$/i.exec(timezone.trim());
    if (match) {
        const sign = match[1] === '-' ? -1 : 1;
        const hours = parseInt(match[2], 10);
        const minutes = match[3] ? parseInt(match[3], 10) : 0;
        const offsetMinutes = sign * (hours * 60 + minutes);
        const local = new Date(Date.now() + offsetMinutes * 60 * 1000);
        const timeString = local.toLocaleString();
        return { time: timeString, zone: timezone, label };
    }

    return { time: 'N/A', zone: timezone, label };
}

function displayCountryInfo(country, extras) {
    const modalBody = document.getElementById('modalBody');
    
    const name = country.name.common;
    const population = country.population.toLocaleString();
    const flag = country.flags.svg || country.flags.png;
    const capital = country.capital ? country.capital[0] : 'N/A';
    const languages = country.languages ? Object.values(country.languages).join(', ') : 'N/A';
    
    modalBody.innerHTML = `
        <div class="modal-header">
            <img src="${flag}" alt="${name} flag" class="modal-flag">
            <h2 class="modal-title">${name}</h2>
        </div>
        <div class="modal-info">
            <div class="info-row"><span class="info-label">Befolkning:</span><span class="info-value">${population}</span></div>
            <div class="info-row"><span class="info-label">Hovedstad:</span><span class="info-value">${capital}</span></div>
            <div class="info-row"><span class="info-label">Språk:</span><span class="info-value">${languages}</span></div>
            <div class="info-row"><span class="info-label">Valuta:</span><span class="info-value">${extras.currencies}</span></div>
            <div class="info-row"><span class="info-label">Demonym:</span><span class="info-value">${extras.demonym}</span></div>
            <div class="info-row"><span class="info-label">Areal:</span><span class="info-value">${extras.area}</span></div>
            <div class="info-row"><span class="info-label">BNP:</span><span class="info-value">${extras.gdpTotal}</span></div>
            <div class="info-row"><span class="info-label">BNP pr. innbygger:</span><span class="info-value">${extras.gdpPerCapita}</span></div>
            <div class="info-row"><span class="info-label">Gini:</span><span class="info-value">${extras.gini}</span></div>
            <div class="info-row"><span class="info-label">Tidssone:</span><span class="info-value">${extras.timezone}</span></div>
            <div class="info-row"><span class="info-label">Klokkeslett nå:</span><span class="info-value">${extras.timeInfo.time} (${extras.timeInfo.label})</span></div>
            <div class="info-row"><span class="info-label">Retningsnummer:</span><span class="info-value">${extras.callingCode}</span></div>
            <div class="info-row"><span class="info-label">TLD:</span><span class="info-value">${extras.tld}</span></div>
        </div>
    `;
}

function closeModal() {
    const modal = document.getElementById('countryModal');
    modal.classList.remove('active');
}

window.onclick = function(event) {
    const modal = document.getElementById('countryModal');
    if (event.target === modal) {
        closeModal();
    }
}