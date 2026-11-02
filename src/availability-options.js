export function availabilityOptions(people, availability, showResponded = false) {
  if (showResponded) return people;
  const responded = new Set([...availability.available, ...availability.notAvailable].map((person) => person.id));
  return people.filter((person) => !responded.has(person.id));
}
