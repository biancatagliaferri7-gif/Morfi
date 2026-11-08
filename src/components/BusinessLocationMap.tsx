import { useEffect, useState } from 'react';
import { describeLocation } from '../business/locationDescription';

export default function BusinessLocationMap({
  latitude,
  longitude,
}: {
  latitude: number;
  longitude: number;
}) {
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setDescription('');
    setError('');

    void describeLocation(latitude, longitude)
      .then(result => {
        if (active) setDescription(result);
      })
      .catch(caught => {
        const detail = caught instanceof Error ? caught.message : 'Error inesperado.';
        if (active) setError(`No se pudo obtener la descripción de la dirección: ${detail}`);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [latitude, longitude]);

  const latitudeOffset = 0.006;
  const longitudeOffset = 0.008;
  const mapUrl = new URL('https://www.openstreetmap.org/export/embed.html');
  mapUrl.searchParams.set('bbox', [
    longitude - longitudeOffset,
    latitude - latitudeOffset,
    longitude + longitudeOffset,
    latitude + latitudeOffset,
  ].join(','));
  mapUrl.searchParams.set('layer', 'mapnik');
  mapUrl.searchParams.set('marker', `${latitude},${longitude}`);
  const directionsUrl = `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=17/${latitude}/${longitude}`;

  return (
    <div className="mt-3 space-y-2">
      <p className="text-xs text-gray-600">
        Al elegir esta ubicación, se consulta OpenStreetMap para mostrar el mapa y una referencia de dirección.
      </p>
      <iframe
        title="Mapa de ubicación del emprendimiento"
        src={mapUrl.toString()}
        loading="lazy"
        className="h-56 w-full rounded-xl border border-orange-100"
      />
      <p className="text-sm font-semibold">Referencia para llegar</p>
      {loading && <p role="status" className="text-sm text-gray-600">Buscando la dirección aproximada…</p>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {description && <p className="text-sm text-gray-700">{description}</p>}
      <a href={directionsUrl} target="_blank" rel="noreferrer" className="inline-block text-sm font-semibold underline">
        Ver indicaciones en OpenStreetMap
      </a>
    </div>
  );
}
