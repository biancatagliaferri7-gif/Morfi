type ReverseGeocodeResponse = {
  display_name?: string;
  address?: Record<string, string | undefined>;
};

export async function describeLocation(latitude: number, longitude: number): Promise<string> {
  const parameters = new URLSearchParams({
    format: 'jsonv2',
    lat: String(latitude),
    lon: String(longitude),
    zoom: '18',
    addressdetails: '1',
  });
  const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${parameters}`);
  if (!response.ok) {
    throw new Error(`OpenStreetMap respondió con el estado ${response.status}.`);
  }

  const result = await response.json() as ReverseGeocodeResponse;
  const address = result.address;
  if (!address) {
    if (result.display_name) return result.display_name;
    throw new Error('No se encontró una dirección para estas coordenadas.');
  }

  const street = [address.road, address.house_number].filter(Boolean).join(' ');
  const area = address.neighbourhood ?? address.suburb ?? address.city_district;
  const city = address.city ?? address.town ?? address.village ?? address.municipality;
  const description = [street, area, city, address.state].filter(Boolean).join(', ');
  if (description) return description;
  if (result.display_name) return result.display_name;
  throw new Error('No se encontró una dirección para estas coordenadas.');
}
