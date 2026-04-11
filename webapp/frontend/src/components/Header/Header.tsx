import { NavLink } from 'react-router-dom'
import styles from './Header.module.css'

export function Header() {
  return (
    <header className={styles.header}>
      <NavLink to="/" className={styles.title}>
        Finding the Finger
      </NavLink>
      <nav className={styles.nav}>
        <NavLink to="/" className={({ isActive }) => isActive ? `${styles.link} ${styles.active}` : styles.link} end>
          Search
        </NavLink>
        <NavLink to="/map" className={({ isActive }) => isActive ? `${styles.link} ${styles.active}` : styles.link}>
          Map
        </NavLink>
        <NavLink to="/about" className={({ isActive }) => isActive ? `${styles.link} ${styles.active}` : styles.link}>
          About
        </NavLink>
      </nav>
    </header>
  )
}
