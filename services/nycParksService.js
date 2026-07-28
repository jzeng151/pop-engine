import fetch from 'node-fetch';

const NYC_PARKS_PERMIT_AREAS_ENDPOINT = 'https://data.cityofnewyork.us/resource/c5vm-g2dk.json';

/**
 * Discovers available NYC Park permit zones filtered by borough and capacity needs
 */
export async function discoverNycParkSpaces(borough, limit = 10) {
  try {
    const formattedBorough = borough.trim().toUpperCase();
    const queryUrl = `${NYC_PARKS_PERMIT_AREAS_ENDPOINT}?$where=upper(borough)='${formattedBorough}'&$limit=${limit}`;

    const response = await fetch(queryUrl);
    if (!response.ok) {
      throw new Error(`NYC Open Data API returned status: ${response.status}`);
    }

    const parkZones = await response.json();
    return parkZones.map((park) => ({
      locationId: park.gispropnum || park.objectid,
      parkName: park.name || 'NYC Park Zone',
      borough: park.borough,
      type: park.typecategory || 'Special Event Area',
      acres: park.acres || 'N/A',
    }));
  } catch (error) {
    console.error('[NYC Parks Discovery Error]', error);
    throw error;
  }
}

/**
 * Validates NYC Parks Insurance Minimums ($1M per occurrence / $2M aggregate)
 */
export function validateNycInsuranceRequirements(coveragePerOccurrence, aggregateCoverage, includesCityAddInsured) {
  const errors = [];

  if (coveragePerOccurrence < 1000000) {
    errors.push('General Liability must be at least $1,000,000 per occurrence.');
  }
  if (aggregateCoverage < 2000000) {
    errors.push('Aggregate coverage must be at least $2,000,000.');
  }
  if (!includesCityAddInsured) {
    errors.push('The "City of New York" must be explicitly listed as an Additional Insured.');
  }

  return {
    isCompliant: errors.length === 0,
    errors,
  };
}
