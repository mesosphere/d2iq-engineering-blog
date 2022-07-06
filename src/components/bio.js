import * as React from "react"

const Bio = ({ author = {} }) => {
  const { name, bio } = author

  return (
    <div className="bio">
      {name && (
        <p>
          <strong>{name}</strong>, {bio}
        </p>
      )}
    </div>
  )
}

export default Bio
